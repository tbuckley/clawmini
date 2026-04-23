# Adapter Visibility: Google Chat Threaded Activity Log (MVP)

## Problem

The Google Chat adapter offers no visibility into what the agent is doing between a user's message and the final reply. Enabling `/show` surfaces intermediate activity as top-level messages, which buzzes the user's phone for every tool call and every subagent update. Disabling `/show` leaves the user staring at nothing until the final reply lands.

We want a lightweight, low-noise way to expose agent progress on demand, without turning every tool call and subagent event into a top-level message.

## MVP scope

**In scope (this doc):**

- Google Chat only.
- One turn's tool / subagent / system activity accumulated into a single **activity-log message** posted inside a thread anchored on the triggering user message.
- The log message is **edited** as events arrive (not reposted) so only the first event in a turn buzzes.
- Per-space opt-out (threads on by default, can be disabled per space).
- End-to-end tests covering the core paths.

**Out of scope (see [Deferred](#deferred) at the bottom):**

- Discord adapter.
- Emoji reactions (any platform).
- Merged messages via `fetch-pending` / `/interrupt`.
- Proactive turns (cron / scheduled wake-ups) getting their own threads.
- Expand-on-demand full tool detail.

Top-level message flow (the final agent reply) is unchanged by this MVP.

## Key constraint: edits, not new thread messages

Google Chat push-notifies thread participants (including the user who started the thread) on every new thread message, but **not** on edits. So the activity log inside the thread must be one message that we edit, not N separate messages. This shapes the whole design.

When a log message gets too long for a single GChat message (4096-char limit), we finalize it and post a new one to the same thread — accepting the one extra buzz as the cost of continued detail.

## Concepts

### Turn

One unit of agent work: a user message plus all agent / subagent / tool activity that follows, until the agent stops. A turn has a stable `turnId` assigned by the daemon when the user message starts executing.

### Turn root

The adapter-visible user message the turn hangs off. In this MVP, every turn has exactly one root: the user message the daemon was handed via `executeDirectMessage`. Merged roots (adoption via `fetch-pending` / `/interrupt`) are deferred.

### Activity log message

A single message inside the turn's thread that accumulates an event log (tool calls, subagent updates, system events) via edits. One buzz when it is first posted; zero buzzes for subsequent activity within that log message.

## Data model changes

### 1. `turnId` in the daemon

`BaseMessage` in `src/shared/chats.ts` does not currently carry any turn concept. Add:

- `turnId?: string` on `BaseMessage` — populated on every non-user message generated during a turn. Also populated on the triggering user message once the turn is formed.

Add lifecycle events to `src/daemon/events.ts`:

- `DAEMON_EVENT_TURN_STARTED` — emitted with `{ chatId, turnId, rootMessageId }` when `executeDirectMessage` begins agent work (not for pure no-op routes like `/stop`).
- `DAEMON_EVENT_TURN_ENDED` — emitted with `{ chatId, turnId, outcome: 'ok' | 'error' }` when the agent session's `handleMessage` promise settles.

Emission sits in `src/daemon/message.ts` around the `agentSession.handleMessage(finalMessage)` call at `message.ts:83`. Wrap with try/finally so `turnEnded` fires on both success and error paths. The `turnId` is a fresh UUID generated just before the call; the daemon stamps it onto every message logged during that call (via `createChatLogger` — which needs a `turnId` field threaded through, or can read it from an async-local).

Expose a new TRPC subscription in `src/daemon/api/user-router.ts` alongside `waitForMessages` and `waitForTyping`:

- `waitForTurns({ chatId, lastTurnCursor? })` — yields `{ type: 'started' | 'ended', turnId, rootMessageId?, outcome? }`.

Adapters use this subscription to drive thread creation and log finalization.

**Note:** `messagesAdopted` (for merged turns) is explicitly *not* added in the MVP. When we add it later, the shape of `TurnContext.rootAdapterMessageIds` already supports multiple roots.

### 1a. `turnId` propagation through subagents

Subagents do not naturally inherit the parent's turn identity. Each subagent is its own `AgentSession` (`src/daemon/api/subagent-router.ts:28`), spawned via `executeSubagent` in `src/daemon/api/subagent-utils.ts`, which generates a *fresh* `messageId` (line 36) and routes through its own `executeDirectMessage` call. Without explicit propagation, every subagent spawn would start a new "turn" from the forwarder's perspective and fragment the activity log into multiple threads.

The MVP must propagate `turnId` end-to-end:

- **Spawn site** (`subagent-utils.ts`): accept the parent's `turnId` as input, attach it to the synthetic user message handed to the subagent's session, and thread it into the subagent's `createChatLogger` call so every message that subagent emits carries the same `turnId`.
- **Subagent spawn API** (`subagent-router.ts:subagentSpawn`): accept and forward `turnId` from the calling parent context. The parent agent's tool dispatch must have access to the current `turnId` (same plumbing as the parent's logger).
- **Nested subagents** (depth up to `MAX_SUBAGENT_DEPTH = 2`, `subagent-router.ts:13`): propagate the *root* `turnId`, not the immediate parent's session-level identity. A grandchild subagent's messages must carry the same `turnId` as the original user-triggered turn.
- **API-path log endpoints** that today generate fresh `messageId` UUIDs (`agent-router.ts:logToolMessage` line 119, `agent-policy-endpoints.ts` line 112): they must read `turnId` from the calling session's context and stamp it onto the logged message. These call sites are the highest-risk places to miss propagation, since they're invoked from inside subagent execution and currently have no link back to the spawning context.
- **`SubagentStatusMessage`** (`src/shared/chats.ts:70`) currently has no `messageId` field. Add `turnId` to this message type explicitly. It is emitted from inside the subagent's logger context (`subagent-utils.ts:81`), so once the logger carries `turnId`, this falls out for free.

Verification: a unit test that spawns a 2-level-deep subagent tree and asserts every message logged across all three sessions carries the same `turnId` as the originating user message. This test is the gate for step 1 of the implementation order — without it the threaded log will silently fragment in any turn that uses subagents (which is most non-trivial turns).

`AgentReplyMessage` from a subagent is internal to the parent agent's flow (returned as a tool result, not surfaced to the user), so its routing is unchanged — but it must still carry `turnId` so logging/debugging stays coherent.

### 2. Capture the GChat `message.name` of the user's message

The GChat client currently discards the inbound user message's `message.name` after routing it to the daemon. For threading, we need two things from the inbound event: `message.name` (for thread anchoring) and `message.thread.name` (GChat's thread identifier — which may already exist if the user posted in a thread, or will be assigned once we open one).

Store on the existing `channelChatMap[space]` entry (`src/adapter-google-chat/state.ts:8–18`) — per chat, a small ring buffer of recent `{ daemonMessageId, gchatMessageName, gchatThreadName }`. This avoids needing a new adapter→daemon round-trip for `adapterMessageId` (previous design). Ring buffer size: last 50 entries per chat; older entries age out.

This keeps all the wiring inside the GChat adapter — no schema changes in the shared layer for message IDs.

### 3. Capture the GChat `message.name` of each activity log message

When the forwarder posts the first thread-log message of a turn, it must remember the returned `message.name` (currently discarded at `forwarder.ts:238`) so subsequent events can edit it. Store on an in-memory `TurnContext`:

```ts
type TurnContext = {
  turnId: string;
  chatId: string;
  rootDaemonMessageId: string;
  rootGchatMessageName: string;   // spaces/XXX/messages/YYY of user message
  gchatThreadName: string;        // spaces/XXX/threads/ZZZ
  activityLogMessageName?: string; // spaces/XXX/messages/WWW — current log message
  entries: TurnLogEntry[];         // all entries since the current log message was opened
  renderedEntryCount: number;      // how many of `entries` are already reflected in the posted text
  editTimer?: NodeJS.Timeout;      // debounce handle
};
```

Entries are the source of truth; the posted text is a *view* produced by the condenser (see [Formatting](#formatting)). Keeping the structured list — rather than a pre-rendered text buffer — is what lets the condenser try different strategies (drop earliest, re-truncate more aggressively, collapse runs) without the forwarder having to reconstruct history.

Keyed by `turnId`, held in a `Map` on the forwarder module. Deleted on `turnEnded` after the final flush completes.

## Event routing

The forwarder already calls `shouldDisplayMessage()` (from `src/shared/adapters/filtering.ts`) which returns `boolean`. Extend that function to return a `Destination`:

```ts
type Destination =
  | { kind: 'drop' }
  | { kind: 'top-level' }
  | { kind: 'thread-log' }
  | { kind: 'thread-message' }; // policy cards — needs its own message with a card
```

The function still honors the same `filters` config (verbose / user / subagent_status); it just now also maps the *allowed* messages to a destination instead of a flat boolean.

Default routing for the MVP:

| Message role / event | Destination |
|---|---|
| `UserMessage` | `drop` (echoing user text back is not useful) |
| `AgentReplyMessage` (final reply) | `top-level` |
| `ToolMessage` | `thread-log` (truncated, see [Formatting](#formatting)) |
| `SubagentStatusMessage` | `thread-log` |
| `SystemMessage{event: 'subagent_update'}` | `thread-log` |
| `SystemMessage{event: 'cron'}` | `top-level` (unchanged; proactive-turn threading is deferred) |
| `SystemMessage{event: 'policy_approved' / 'policy_rejected'}` | `thread-log` |
| `PolicyRequestMessage` (pending) | `thread-message` (keeps current cardsV2 behavior; posts inside the thread) |
| `CommandLogMessage` | `thread-log` |
| `LegacyLogMessage` | existing behavior (respect `filters.verbose`) |

All defaults overridable by existing `filters` config. Per-space `visibility.threads: false` collapses `thread-log` and `thread-message` back to `top-level` (preserving current behavior for spaces that opt out).

## Threading behavior

### Thread anchoring

When the adapter receives the first `thread-log` event for a turn:

1. Look up `TurnContext` by `turnId`. If absent (first event), build one:
   - Resolve `rootGchatMessageName` + `gchatThreadName` from the ring buffer (populated when the user message came in).
   - If the user message is not in the ring buffer (edge case: daemon turn started before adapter caught up), fall back to `top-level` for this turn and log a warning.
2. Post the log message using `spaces.messages.create` with:
   ```ts
   {
     parent: 'spaces/XXX',
     requestBody: { text: formattedEvent, thread: { name: gchatThreadName } },
     messageReplyOption: 'REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD',
   }
   ```
3. Store the returned `message.name` as `activityLogMessageName`.

Subsequent `thread-log` events for the same turn:

1. Run `formatTurnLogEntry(message)` and push the result onto `entries`.
2. Schedule (or extend) a debounce timer — 1000ms coalescing window.
3. When the timer fires, run `condenseTurnLog(entries, maxLogMessageChars)` to produce the text, then call `spaces.messages.update` with `updateMask: 'text'`.

### Overflow handling

The condenser owns the decision of how to fit `entries` into `maxLogMessageChars`. It returns one of:

- `{ kind: 'fits', text }` — text fits in one message; post as-is.
- `{ kind: 'rollover', finalText, carryEntries }` — the current log message should be finalized with `finalText` (ending in `• …log continues`), and `carryEntries` should seed a fresh log message in the same thread.

On `rollover`: flush the final edit to `activityLogMessageName`, clear it, reset `entries` to `carryEntries` and `renderedEntryCount` to 0. The next scheduled flush posts a new `spaces.messages.create` under the same `gchatThreadName`.

Rollover is thus one possible condenser strategy, not a separate code path. A condenser that never returns `rollover` (e.g., one that aggressively drops earliest entries) keeps the whole turn in a single message; a condenser that always rolls over matches today's "fixed max, new message on overflow" behavior. See [Formatting](#formatting) for the strategies the MVP ships.

### Thread-message (non-log) routing

`PolicyRequestMessage` currently posts as a cardsV2 message at the top level of the space. With threading enabled, route it to the turn's thread (same `thread.name`, same `messageReplyOption`). This buzzes once; acceptable because the user has to act on it. The existing plain-text fallback path (`forwarder.ts:157` — when cardsV2 fails) uses the same thread.

### `turnEnded` handling

On `turnEnded`:

1. Flush any pending edit immediately (cancel the debounce, send now).
2. Drop the `TurnContext` from the map.

The final agent reply is routed `top-level` (not into the thread) so the user sees it as a normal reply in the space, same as today.

## DM behavior

Google Chat DMs (`space.type === 'DIRECT_MESSAGE'` — detected today at `client.ts:318`) do not support threading the same way spaces do. In the MVP:

- Detect the DM at turn start (the `channelChatMap` entry already tells us the space).
- For DMs, force destination `thread-log` → `drop`, `thread-message` → `top-level`. This preserves today's DM behavior exactly; activity-log visibility is a spaces-only feature in the MVP.
- Document this clearly in the config — users who DM the bot will not see threaded activity.

A later iteration could flatten the log into a collapsible summary line sent top-level at turn end; out of scope now.

## Formatting

Formatting the turn log is split into two pure functions with distinct responsibilities. Keeping them separate is what lets us try different condensation strategies (aggressive per-entry truncation, dropping earliest entries, collapsing runs of similar events) without rewriting the per-message formatter.

Both functions live in a new module `src/shared/adapters/turn-log.ts` so Discord and any future adapter can reuse them.

### 1. `formatTurnLogEntry(message: ChatMessage): TurnLogEntry | null`

Pure function. Takes a single `ChatMessage` and returns a structured entry, or `null` if the message is not part of the log (e.g., `UserMessage`, `AgentReplyMessage`, filtered-out by role).

```ts
type TurnLogEntry = {
  timestamp: string;              // HH:MM:SS, daemon-local
  kind: 'tool' | 'subagent' | 'policy' | 'system' | 'command';
  summary: string;                // one-line rendered form, already per-entry truncated
  rawLength: number;              // untruncated content length — lets the condenser decide how much to re-cut
  subagentId?: string;            // for indentation/grouping in future formatters
  messageRole: string;            // for telemetry / debugging
};
```

Example output (the `summary` field), one line per entry:

```
• 12:04:02  tool: Read(src/app.ts)
• 12:04:04  tool: Grep("TODO") — 7 matches
• 12:04:08  subagent: Explore started
• 12:04:41  subagent: Explore done (14s)
• 12:05:02  policy: approved rm -rf /tmp/cache
```

The formatter applies `maxToolPreview` (default 400 chars) to tool content, replaces embedded newlines with spaces, and appends `…[truncated]` when it cuts. It does **not** know about the overall message length budget — that's the condenser's job. Timestamp is wall-clock in the daemon's local timezone, `HH:MM:SS`; no date, since the thread anchors the day.

### 2. `condenseTurnLog(entries: TurnLogEntry[], opts): CondenseResult`

Pure function. Takes the full list of entries and a max-length budget and decides how to fit within a single GChat message (4096 chars, minus safety margin). Returns either a text that fits, or a rollover signal (see [Overflow handling](#overflow-handling)).

```ts
type CondenseOpts = {
  maxChars: number;               // default 3500
  strategy: 'rollover' | 'drop-earliest' | 'aggressive-truncate' | 'hybrid';
};

type CondenseResult =
  | { kind: 'fits'; text: string }
  | { kind: 'rollover'; finalText: string; carryEntries: TurnLogEntry[] };
```

MVP ships multiple strategies behind a config flag so we can A/B them without code changes:

| Strategy | Behavior | Tradeoff |
|---|---|---|
| `rollover` (default) | Accumulate entries; when total exceeds `maxChars`, emit the full current text plus a `• …log continues` marker as `finalText`, carry any overflow entries into a fresh log message. | Preserves all detail; costs one extra buzz per rollover (each new log message in the thread notifies). |
| `drop-earliest` | Keep the most recent entries that fit; prepend `• …N earlier entries dropped` when anything was cut. | Zero buzzes past the first, but early context (which tool started a chain) is lost. |
| `aggressive-truncate` | First pass uses `formatTurnLogEntry` output. If overflowing, re-truncate entries in place (shorter per-entry caps: 400 → 200 → 100) until it fits. | Keeps all entries visible; loses per-entry detail. Deterministic ordering. |
| `hybrid` | Aggressive-truncate first; if still over budget, drop earliest. Rollover only if even an empty-except-latest message would overflow (pathological). | Best of both; more code to maintain. |

The condenser is the *only* place that reads `maxChars`. `formatTurnLogEntry` is oblivious to the budget.

### Testability

Because both functions are pure and operate on plain data, they get unit-tested independently of the forwarder, the debounce machinery, and the GChat API fakes. The forwarder's E2E tests only need to verify that the right function is called at the right time — not exercise every condensation branch. This keeps the condensation strategy A/B safe to iterate on.

## Configuration

Per-adapter config in `src/adapter-google-chat/config.ts`:

```ts
visibility: {
  threads: boolean;                              // default true; global kill switch
  threadLog: {
    maxToolPreview: number;                      // default 400 — passed to formatTurnLogEntry
    maxLogMessageChars: number;                  // default 3500 — passed to condenseTurnLog
    editDebounceMs: number;                      // default 1000
    condenseStrategy: 'rollover' | 'drop-earliest' | 'aggressive-truncate' | 'hybrid';
                                                 // default 'rollover' — see Formatting
  };
};
```

Per-space override on the existing `channelChatMap[spaceName]` entry in `state.ts`:

```ts
channelChatMap: {
  [spaceName]: {
    // …existing fields…
    threadsDisabled?: boolean;   // per-space opt-out
  }
}
```

Resolution order: per-space `threadsDisabled === true` wins; otherwise use global `visibility.threads`. A space admin can set `threadsDisabled` via a new slash command (not in MVP — set via config file edit or TRPC for now; slash command is trivial follow-up).

## Error handling

Failures the forwarder handles explicitly:

- **Thread creation fails** (first `spaces.messages.create` of a turn returns an error): log the error, fall back to `top-level` for this turn's remaining thread-log events, keep the `TurnContext` in a "degraded" state so we don't re-attempt on every event.
- **Edit fails** (transient error on `spaces.messages.update`): retry once after 500ms. If still failing, finalize the current log message (log a warning in the last successful edit's content) and start a fresh one on the next event.
- **Log message deleted by a user**: GChat returns 404 on edit. Treat as a finalize event: open a new log message on the next event.
- **Turn ended with no `thread-log` events**: no thread was ever opened; nothing to clean up. Drop the `TurnContext`.

## Known limitations (called out in docs)

- **Public threads:** GChat threads in a multi-person space are visible to every human in the space. Tool output containing file paths, stack traces, or anything the user wouldn't have posted publicly is exposed. `threadsDisabled` per space is the mitigation.
- **Thread interleaving:** humans can reply in the thread alongside the activity log. Our edits only touch our own message; human replies are preserved and will appear interleaved. Acceptable.
- **Very long turns:** produce a growing thread (many rolled-over log messages). No hard cap; thread is scrollable.
- **Daemon restart mid-turn:** `turnEnded` never fires; the activity log message is left in its last-edited state. Self-heals: the next turn starts a new thread. No recovery logic in MVP.
- **Adapter restart mid-turn:** in-memory `TurnContext` is lost; same outcome as daemon restart. The next event for that turn can't find the log message, so it opens a new one (visible as two log messages in the thread). Acceptable in MVP.

## Implementation order

1. **Daemon turn lifecycle.** Add `turnId` to `BaseMessage` (and to `SubagentStatusMessage`, which lacks `messageId` today); thread it through `createChatLogger`; emit `DAEMON_EVENT_TURN_STARTED` / `DAEMON_EVENT_TURN_ENDED` in `src/daemon/message.ts` around `agentSession.handleMessage`; add `waitForTurns` TRPC subscription. **Critical:** propagate `turnId` through `subagentSpawn` → `executeSubagent` → the subagent's `executeDirectMessage` and logger, recursively for nested subagents (see [§1a](#1a-turnid-propagation-through-subagents)). Also fix the API-path log endpoints (`agent-router.ts:logToolMessage`, `agent-policy-endpoints.ts`) that currently generate fresh `messageId` UUIDs — they must stamp the calling session's `turnId`. No adapter changes yet — verify via unit tests that (a) `turnId` appears on parent-agent messages and (b) a 2-level-deep subagent tree propagates the root `turnId` to every emitted message.
2. **GChat inbound: capture `message.name` + `thread.name`.** Update `client.ts` message-handling paths to push onto the per-chat ring buffer in state before routing to the daemon.
3. **`Destination` routing.** Change `shouldDisplayMessage()` in `src/shared/adapters/filtering.ts` to return `Destination`. Keep existing callers (Discord forwarder) working by mapping `{ kind: 'drop' }` → `false` and everything else → `true` via a tiny shim until Discord's turn to migrate.
4. **Forwarder: `TurnContext` + thread posting.** Subscribe to `waitForTurns` alongside `waitForMessages`. On first `thread-log` event, post threaded message; on subsequent events, coalesce + edit with debounce. On `turnEnded`, flush + clean up.
5. **Thread-message routing.** Thread policy-request cards into the same thread as the turn's activity log.
6. **Per-space config + DM fallback.** Honor `threadsDisabled` and DM detection.
7. **E2E tests.** See [E2E test plan](#e2e-test-plan).

Each step merges independently; after step 4 the feature is functional behind config; steps 5–6 are polish.

## E2E test plan

All tests extend the existing fixtures in `e2e/adapters/_google-chat-fixtures.ts` (`makeFakeChatApi`, `runForwarder`, `useGoogleChatAdapterEnv`, `seedChatForForwarderCatchup`) — no new harness needed. The fake Chat API already records `create` and `update` calls; we add assertions against their `thread` field, `messageReplyOption`, and `updateMask`.

New file: **`e2e/adapters/adapter-google-chat-threads.test.ts`**. Tests:

### Core happy path

1. **`opens a thread anchored on the user's message for the first thread-log event`**
   Seed a chat with a user message (capture its synthetic `message.name` in state); inject a `ToolMessage` with `turnId=T1` while `waitForTurns` has just emitted `started`. Assert `create` was called with `thread: { name: <user thread name> }` and `messageReplyOption: 'REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD'`, and that the returned `message.name` is retained for the next event.

2. **`edits the same log message on subsequent thread-log events`**
   Inject a second `ToolMessage` on the same `turnId=T1`. Wait past the debounce window. Assert exactly one `update` call was made with `name` = first log message's name, `updateMask: 'text'`, and `requestBody.text` containing both events.

3. **`coalesces bursts of thread-log events into a single edit`**
   Inject three `ToolMessage`s within the debounce window (1000ms). Assert one `update` call, not three, and the final text contains all three events in order.

4. **`routes the final AgentReplyMessage to top-level, not the thread`**
   After thread-log activity, inject an `AgentReplyMessage` with the same `turnId`. Assert the create call for the reply has no `thread` field (or uses the space's root, not the turn thread).

5. **`flushes pending edits on turnEnded`**
   Inject a `ToolMessage` then immediately emit `turnEnded` (before the debounce fires). Assert one `update` landed with the buffered event.

### Routing & filters

6. **`drops UserMessage regardless of filters`**
   Inject a `UserMessage` with `turnId`. Assert no `create` or `update` call was made for it.

7. **`routes PolicyRequestMessage into the turn thread with its cardsV2 payload`**
   After opening a thread via a ToolMessage, inject a pending `PolicyRequestMessage` with the same `turnId`. Assert the cardsV2 create call included `thread: { name: <thread> }` and `messageReplyOption: 'REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD'`.

8. **`honors existing filters config (verbose off hides subagent_update)`**
   With `filters: { verbose: false }`, inject `SystemMessage{event: 'subagent_update'}`. Assert no create/update was issued.

### Formatter & condenser (unit tests)

These live next to the pure functions in `src/shared/adapters/turn-log.test.ts`, not in the E2E suite — they don't touch the forwarder.

- **`formatTurnLogEntry` returns null for UserMessage / AgentReplyMessage`**, and a structured entry for ToolMessage / SubagentStatusMessage / PolicyRequestMessage / CommandLogMessage / applicable SystemMessages.
- **`formatTurnLogEntry` truncates tool content longer than maxToolPreview`** — assert `…[truncated]` suffix, line length ≤ budget.
- **`formatTurnLogEntry` replaces newlines in tool content with spaces`** — prevents multi-line entries from visually breaking the log.
- **`condenseTurnLog(strategy: rollover) fits when under budget`** — returns `{ kind: 'fits', text }`.
- **`condenseTurnLog(strategy: rollover) rolls over when exceeded`** — returns `{ kind: 'rollover' }` with `finalText` ending in `…log continues` and `carryEntries` equal to the overflow tail.
- **`condenseTurnLog(strategy: drop-earliest) drops oldest entries and prepends a count marker`** — asserts `• …N earlier entries dropped` line and that only latest entries remain.
- **`condenseTurnLog(strategy: aggressive-truncate) shortens per-entry summaries to fit`** — inject entries whose full-length form overflows; assert output fits and `rawLength > summary.length` for the truncated entries.
- **`condenseTurnLog(strategy: hybrid) truncates first, then drops`** — budget tight enough that truncation alone can't fit; assert truncation applied *and* earliest entries dropped.
- **`condenseTurnLog is pure`** — call twice with identical inputs, assert identical output and no mutation of `entries`.

### Roll-over & length (E2E)

9. **`rolls over to a new thread-log message under the default rollover strategy`**
   Configure `maxLogMessageChars: 200, condenseStrategy: 'rollover'`. Inject ToolMessages whose formatted lines exceed 200 chars total. Assert two separate `create` calls inside the same thread, the first ends with the `…log continues` marker, the second begins with the carry-over entries.

10. **`drop-earliest strategy keeps one message and drops old entries`**
    Configure `maxLogMessageChars: 200, condenseStrategy: 'drop-earliest'`. Inject enough ToolMessages to overflow multiple times. Assert exactly one `create` and N `update`s (no rollover), and the final text starts with `• …N earlier entries dropped`.

11. **`aggressive-truncate strategy keeps all entries with shortened summaries`**
    Configure `maxLogMessageChars: 300, condenseStrategy: 'aggressive-truncate'`. Inject several ToolMessages with long content. Assert one `create`, text fits under 300 chars, contains one line per injected entry, and entries show `…[truncated]` markers.

### Config & DM

12. **`falls back to top-level when threadsDisabled is set on the space`**
    Mark the space as `threadsDisabled: true`. Inject a ToolMessage with a turnId. Assert create has no `thread` field — activity is posted at top-level just like today.

13. **`falls back to top-level when visibility.threads is false globally`**
    Same as above but via global config.

14. **`DM spaces never open a thread`**
    Seed a DM space (`singleUserBotDm: true`). Inject a ToolMessage. Assert the thread-log event was dropped entirely (not posted anywhere); only final AgentReplyMessage appears at top-level.

### Error handling

15. **`falls back to top-level when thread-log create fails`**
    Mock `create` to reject on the first thread-log post. Assert the error is logged, subsequent thread-log events in the same turn post top-level (not retry thread creation), and `turnEnded` cleans up state.

16. **`finalizes and re-creates on edit failure`**
    Create succeeds; mock `update` to reject twice in a row. Assert that after the retry fails, the next thread-log event posts a fresh log message in the same thread (new `create`), not another edit.

17. **`recovers from a 404 on edit by opening a new log message`**
    Mock `update` to reject with a 404-shaped error. Assert the next event opens a new log message rather than editing the missing one.

### Lifecycle & state

18. **`cleans up TurnContext on turnEnded`**
    After `turnEnded`, inject a new turn with the same chatId. Assert the new turn opens its own thread (does not reuse the prior turn's log message).

19. **`handles turnEnded with no thread-log events as a no-op`**
    Emit `turnStarted` then `turnEnded` with only an AgentReplyMessage between them. Assert no thread was opened and no errors surfaced.

### Subagent propagation

20. **`groups parent-agent and subagent activity into one thread`**
    Within a single `turnId=T1`, inject a parent `ToolMessage`, then a `SubagentStatusMessage` (started), then a `ToolMessage` emitted from inside the subagent (carrying the same `turnId=T1` and a `subagentId`), then a `SubagentStatusMessage` (done). Assert exactly one thread was opened and all four events appear in the same activity log message.

21. **`propagates turnId through nested subagents`**
    Inject events from a 2-level-deep subagent tree (parent + child + grandchild), all carrying `turnId=T1`. Assert all events land in the same thread and same activity log message — no fragmentation across spawn boundaries.

22. **`activity from a subagent without turnId does not open a second thread`**
    Regression guard: if a subagent message somehow arrives without a `turnId` (propagation bug), assert the forwarder logs a warning and routes it `top-level` rather than opening an unrelated thread. Prevents silent fragmentation.

All tests must run with `npm run validate` green before merge.

## Deferred

Preserved from the prior spec; implemented after the MVP ships and users have lived on it for a bit.

### Discord adapter

Same shape (threaded activity log, edit-coalescing). Discord has a richer API (`Message.startThread`, `ThreadChannel.send`, `Message.edit` with `MessageFlags.SuppressNotifications`) but also a 5-edits-per-5-seconds rate limit — the same debounce logic applies. Discord DMs don't support threads at all, so the DM fallback is more prominent there.

### Emoji reactions

One reaction per turn root (👀 queued / 🤔 thinking / 🔧 tool running / ✅ done / ❌ error / 🔁 superseded), with atomic swap. This is purely additive — it does not touch the thread-log flow.

### Merged messages via `fetch-pending` / `/interrupt`

Add `messagesAdopted(turnId, messageIds[])` event; generalize `TurnContext.rootGchatMessageName` → `rootGchatMessageNames[]`; pick the anchor (first root vs latest root) based on UX testing. The MVP's single-root design doesn't prevent this — it's additive.

### Proactive turns (cron / wake-ups)

Add `showJobNotifications: 'none' | 'top-level'` config; when `'top-level'`, the adapter posts a synthetic `🕒 Cron: <name>` top-level message, registers it as the turn's root, and the same threaded activity log hangs off it. Plumbing already in place — just add the synthetic-root path.

### Expand-on-demand

User reacts ➕ on a log entry to replace it with the full detail (useful when a tool output was truncated). Requires per-line message IDs inside the log (we don't have them today; entries are lines in one message) or separate log messages per entry — neither is worth it in the MVP.

## Open questions

1. **Turn ID plumbing:** easiest to thread `turnId` through `createChatLogger` (logger is already per-chat, per-session; adding per-turn is a small step) vs. async-local-storage. Leaning toward explicit parameter for testability.
2. **Thread anchor when the user posted inside an existing thread:** if the user's message is itself a reply in some existing thread, do we post the activity log in *that* thread or a new one anchored on the user message? Current plan: reuse the existing thread (honor the user's choice to be in a thread). Confirm with a real GChat test.
3. **`threadsDisabled` surface:** MVP requires editing state file directly. Post-MVP: `/threads off` slash command? Per-user preference in DMs (moot since DMs don't thread)?
4. **Final-reply-in-thread option:** some users may prefer the final reply *also* goes in the thread (clean up space noise). Config option for later; MVP keeps final reply top-level.
