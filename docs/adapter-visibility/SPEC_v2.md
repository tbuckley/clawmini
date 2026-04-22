# Adapter Visibility v2: Simplifications

## Context

v1 ([SPEC.md](./SPEC.md)) shipped a threaded activity log for Google Chat. Four things in that design are more complex than they need to be. v2 is a refactor — same user-visible behavior, smaller surface area.

The four changes, roughly ordered from least to most disruptive:

1. Merge `turnStarted` / `turnEnded` into the existing chat-message stream.
2. Keep `subagent_update` on the parent's original `turnId` instead of minting a new one.
3. Fire `turnEnded` only after all async subagents for that turn have settled.
4. Drop the on-disk inbound ring buffer in favor of an in-memory map shared within the adapter process.

None of these change the `visibility.*` config surface or the `Destination` routing from v1.

## 1. Single event stream

### Today

`src/daemon/api/turns-router.ts` exposes `waitForTurns`, a separate tRPC subscription alongside `waitForMessages`. The forwarder runs both subscriptions per chat and serializes their outputs through a shared `messageQueue` to avoid `turnStarted`-vs-first-message ordering races.

### v2

Collapse turn lifecycle events into `waitForMessages`. The stream yields a discriminated union:

```ts
type ChatStreamItem =
  | { kind: 'message'; message: ChatMessage }
  | { kind: 'turn'; event: TurnLifecycleEvent };

type TurnLifecycleEvent =
  | { type: 'started'; turnId: string; rootMessageId: string; externalRef?: string }
  | { type: 'ended'; turnId: string; outcome: 'ok' | 'error' };
```

The daemon emits turn events onto the same `daemonEvents` channel as messages (or a merged one), and `waitForMessages`'s subscription generator interleaves them in emission order.

### Why

- The ordering race the `messageQueue` exists to solve disappears — events arrive in emission order on a single subscription.
- One subscription per chat instead of two; fewer reconnect cursors, fewer error paths.
- `turns-router.ts` and its merge-two-async-iterators machinery delete entirely.

### Cost

- `waitForMessages` is no longer "only chat messages" — consumers must handle the envelope. For CLI-style consumers that don't care about turns, this is one `if (item.kind !== 'message') continue` line.
- Backpressure/ordering across the two event types now lives in the daemon's emitter, not the adapter. Straightforward since `EventEmitter` is already synchronous FIFO.

### Migration

`waitForTurns` remains for one release as a thin shim that filters the merged stream, then is removed. Forwarder migrates to the merged stream first; other adapters are unaffected.

## 2. Subagent completion stays on the parent's turn

### Today

`src/daemon/api/subagent-utils.ts` inherits `parentTurnId` for the synchronous execution phase, but when an async subagent finishes and calls back into the parent agent via the `subagent_update` system event, `executeDirectMessage` is invoked *without* a `parentTurnId`, minting a fresh `turnId`. That fragments the activity log: the delegated work and the parent's response-to-completion land on different turns.

The code comment at `subagent-utils.ts:~125` explicitly calls this out (`// no parentTurnId — this starts a fresh turn for the parent`). It's a workaround for the fact that, under v1's semantics, the original turn already ended when the parent's agent loop exited.

### v2

`subagent_update` inherits the original parent `turnId`. The turn represents the *logical conversation turn*, not a single agent-loop invocation. Delegated work, async completion, and the parent's follow-up response are all the same turn.

Concretely: `executeSubagent` captures the parent's `turnId` at spawn time (it already does, for the sync path) and passes it through to the `subagent_update` `executeDirectMessage` call.

### Why

- Matches the reader's mental model: one user message → one logical turn → one activity log.
- Eliminates a class of "orphan turn" bugs in the forwarder where a proactive-anchor workaround compensates for a turn that shouldn't have existed at all.
- `proactiveAnchors` in the forwarder shrinks in scope — it's only needed for *actually* proactive turns (cron), not for subagent completions.

### Cost

- Couples to change 3. If a subagent completion extends the original turn, `turnEnded` can't fire until completions settle — otherwise the forwarder sees `turnEnded` while new activity is still arriving.

## 3. `turnEnded` waits for subagents

### Today

`turnEnded` fires when `agentSession.handleMessage`'s promise settles — i.e., when the parent agent's loop exits. Async subagents spawned during that loop may still be running. The forwarder compensates by keeping `TurnContext` alive past `turnEnded` via LRU retention, so late subagent activity still lands on the right log.

### v2

The daemon tracks per-turn outstanding subagents and fires `turnEnded` only when the count reaches zero.

Implementation sketch:

```ts
// src/daemon/agent/turn-registry.ts
const outstanding = new Map<string, number>(); // turnId → active subagent count

export function incrementSubagent(turnId: string) { ... }
export function decrementSubagent(turnId: string) {
  // when count hits 0 AND the parent loop has exited, emit turnEnded
}
```

- `executeSubagent` increments on spawn, decrements on completion.
- `executeDirectMessage` marks "parent loop exited" on promise settle; emits `turnEnded` if outstanding count is already 0, otherwise defers to the final subagent's decrement.
- Add a per-turn timeout (config: `turnMaxDurationMs`, default ~30min) that force-fires `turnEnded` with `outcome: 'error'` if the count never drains — protects against stuck subagents pinning the log open forever.

### Why

- Removes the forwarder's need to retain `TurnContext` past `turnEnded`. Cleanup becomes immediate and obvious.
- `turnEnded` becomes a meaningful signal consumers can trust for "activity is done."
- Combined with change 2, the LRU cap on `turnContexts` in the forwarder can go away — contexts live for the duration of their turn and are deleted on `turnEnded`.

### Cost

- One new piece of daemon state (outstanding-count map).
- A stuck subagent now pins the turn until the timeout fires. Acceptable with a reasonable default; operators can tune.

### Optional follow-up

If any consumer needs the "agent stopped typing" signal distinct from "turn fully settled," emit a separate `turnReplyComplete` event when the parent loop exits. **Don't add this preemptively** — wait for a consumer to ask.

## 4. Drop the disk-persisted inbound ring buffer

### Today

`src/adapter-google-chat/state.ts` stores `recentMessages` (ring buffer, 50 entries per space) on disk at `.clawmini/adapters/google-chat/state.json`. On every inbound, `recordInboundMessage` appends; on every `turnStarted`, `resolveInboundByGchatMessageName` reads + Zod-parses the file to find the thread anchor.

The only reason it's on disk is historical — the adapter once ran ingestion and forwarding in separate processes. They don't anymore.

### v2

The adapter's ingestion and forwarder run in the same Node process (`startGoogleChatIngestion` and `startDaemonToGoogleChatForwarder` start side-by-side in `index.ts`). Share an in-memory map:

```ts
// src/adapter-google-chat/inbound-cache.ts
interface InboundRecord {
  gchatMessageName: string;
  gchatThreadName: string;
  receivedAt: number;
}

const cache = new Map<string, InboundRecord>(); // keyed by gchatMessageName

export function recordInbound(r: InboundRecord) { ... }
export function resolveInbound(gchatMessageName: string): InboundRecord | null { ... }
```

- Sweep entries older than `INBOUND_TTL_MS` (default 10min) on every insert — bounded memory without an LRU.
- `externalRef` on the tRPC wire stays unchanged — still the correlation key between a daemon turn and a GChat message.
- `state.json` schema loses `channelChatMap[space].recentMessages` and its `RecentInboundEntrySchema`.

### Companion change: `TurnContext` retention

With change 3, `TurnContext` is deleted on `turnEnded`. Drop `MAX_TURN_CONTEXTS` (the LRU cap) and `evictOldestTurnContextIfFull`. Add a belt-and-suspenders TTL sweeper (default ~30min) for the pathological case where `turnEnded` never fires *and* the timeout somehow also didn't fire.

### Why

- Deletes `recordInboundMessage`, `resolveInboundByGchatMessageName`, `RecentInboundEntrySchema`, the ring-buffer migration path, and the disk I/O on every `turnStarted`.
- Same outcome for the common case (daemon runs indefinitely; in-memory state is authoritative).
- `proactiveAnchors` is already in-memory and stays as-is — it's the other half of anchor resolution and already small.

### Cost

- **Adapter restart mid-turn** now loses the inbound cache for any turn that started but hadn't yet seen its `turnStarted` event delivered. Same failure mode as daemon restart mid-turn, which v1 already tolerates. Explicitly a "not the common case" tradeoff.
- **Daemon restart with long-lived adapter:** today the ring buffer survives, but without a `turnStarted` to match it's dead weight anyway. No regression.

## Net code delta (estimate)

Deletions:

- `src/daemon/api/turns-router.ts` — merged into `waitForMessages` (change 1).
- `recordInboundMessage` / `resolveInboundByGchatMessageName` / `RecentInboundEntrySchema` from `state.ts` (change 4).
- `MAX_TURN_CONTEXTS` / `evictOldestTurnContextIfFull` / LRU machinery in `forwarder.ts` (changes 3+4).
- Proactive-anchor fallback paths specific to subagent completions (change 2).

Additions:

- Per-turn outstanding-subagent registry in the daemon (change 3).
- In-memory inbound cache module in the adapter (change 4).
- Stream-envelope type on `waitForMessages` (change 1).

Net: meaningful reduction. `forwarder.ts` in particular sheds the bulk of its turn-lifecycle state management.

## Migration order

Changes are mostly independent; recommended sequence:

1. **Change 2** first — smallest patch, no wire protocol change. Removes a known source of fragmentation in v1. Gate on existing tests.
2. **Change 3** — depends on 2's semantics. Adds the outstanding-count registry; validate with a unit test that an async subagent extends `turnEnded`.
3. **Change 4** — pure adapter-internal refactor; can land independently of 1–3. Removes the ring buffer and its schema.
4. **Change 1** — touches the wire protocol. Land last so 2/3 are stable first. Ship with `waitForTurns` as a shim for one release before removing.

Each step merges independently. `npm run validate` must pass at every step.

## Out of scope

- Discord adapter migration (unchanged from v1 deferred list).
- Emoji reactions, merged turns, expand-on-demand — all still deferred per v1.
- Changing the `Destination` routing or the condenser strategies — these are working as intended.

## Open questions

1. **Turn-timeout default.** 30min feels right for "stuck subagent" protection but is a guess. Instrument first, tune after observing real distributions.
2. **Inbound cache TTL.** 10min covers the realistic inbound→turnStarted delay. Too short risks losing anchors on a laggy daemon; too long wastes memory. Make it configurable, default to 10min.
3. **`turnReplyComplete` event.** Speculative — do we ship it preemptively for future consumers (typing indicator, etc.) or wait? Leaning wait.
4. **Single-stream envelope naming.** `ChatStreamItem` / `{ kind: 'message' | 'turn' }` is a first pass — alternatives like flattening (`{ type: 'message' | 'turn-started' | 'turn-ended' }`) are worth weighing during implementation.
