# Unified Delegation — Implementation Tickets

This file breaks `spec.html` into self-contained tickets. Each ticket leaves the
project in a working state with `npm run validate` passing. Each ticket follows
red-green TDD: write e2e tests first (under `e2e/`), then make them pass.

The work order is chosen so that:

1. New code lands as additive scaffolding (types, store, manager, events) without
   touching live RPCs.
2. Existing policy and subagent RPCs are migrated to the manager one at a time,
   keeping each release shippable.
3. The new agent-facing `delegations` API + CLI lands once the manager owns both
   kinds, so the unified observation surface has both data sources to work with.
4. Approval rules and skill updates land near the end, because they layer on top
   of the manager-backed paths.

Spec section references look like `(§3.2)` — see `spec.html`.

---

## Ticket 0 — Scaffolding & shared utilities — COMPLETE

**Goal.** Land the unified record shape and a thin file-IO `DelegationStore`
without wiring it to any RPC. Everything below builds on this.

**Spec.** §5.6 (Unified record, Layout on disk), §3.1 (state machine), §3.2
(delivery modes).

### Code

1. **New file `src/shared/delegations.ts`** exporting types per §5.6:
   ```ts
   export type DelegationKind  = 'policy' | 'subagent';
   export type DelegationState = 'pending' | 'running' | 'completed' | 'rejected' | 'failed';
   export type DeliveryMode    = 'notify' | 'manual';

   interface DelegationBase {
     id: string;                 // 3-char alphanum, unique per chat
     kind: DelegationKind;
     state: DelegationState;
     delivery: DeliveryMode;
     chatId: string;
     agentId: string;
     parentId?: string;
     createdAt: string;
     resolvedAt?: string;
     rejectionReason?: string;
   }

   export interface PolicyDelegation extends DelegationBase {
     kind: 'policy';
     commandName: string;
     args: string[];
     fileMappings: Record<string, string>;
     cwd?: string;
     executionResult?: { stdout: string; stderr: string; exitCode: number };
   }

   export interface SubagentDelegation extends DelegationBase {
     kind: 'subagent';
     targetAgentId: string;
     sessionId: string;
     prompt: string;
   }

   export type Delegation = PolicyDelegation | SubagentDelegation;
   ```
   Also export a matching `DelegationSchema` (zod `discriminatedUnion` on
   `kind`) reused by the store and any RPCs.

2. **New file `src/daemon/delegation-store.ts`** — thin file-IO layer:
   - Constructor takes a workspace root; computes
     `<root>/.clawmini/tmp/delegations/<chatId>/<id>.json`.
   - Methods: `save(d)`, `load(chatId, id)`, `list(chatId, filter?)`,
     `delete(chatId, id)`, `wipeAll()` (rm-rf `.clawmini/tmp/delegations/`),
     plus subscription IO under `subscriptions/<subscriptionId>.json` (used by
     later tickets).
   - `generateId()` returns 3-char `[0-9a-z]` and grows to 4+ chars on
     collision within the same chat directory (same shape as today's
     `request-store.ts`).
   - Validate on load with the zod schema; throw if the file is corrupt.

3. **No daemon wiring yet.** `RequestStore` and `ChatSettings.subagents`
   remain authoritative. Existing tests pass unchanged.

### Tests

Unit tests under `src/daemon/delegation-store.test.ts`:

- `save() / load()` round-trip both `PolicyDelegation` and `SubagentDelegation`.
- `list()` filters by `chatId`, by `state`, by `kind`.
- `generateId()` produces 3-char ids; on a synthetic collision it grows to 4
  chars.
- `wipeAll()` removes the entire `.clawmini/tmp/delegations/` tree, including
  multiple chat subdirs and a `subscriptions/` dir.

No e2e tests in this ticket — nothing user-visible yet.

### Validation

`npm run validate` must pass. (Unit tests run under vitest in `src/`.)

---

## Ticket 1 — `DelegationManager` scaffolding (no consumers yet) — COMPLETE

**Goal.** Stand up the cross-kind manager + new daemon event. Still no RPC
migration — existing policy/subagent code paths are untouched.

**Spec.** §5.6 (Module shape), §5.6 (Lifecycle invariants — events,
daemon-start wipe).

### Code

1. **New file `src/daemon/delegation-manager.ts`** exporting a singleton
   `DelegationManager` (mirror style of existing `taskScheduler` /
   `policyRequestService` instances).
   - Holds a `DelegationStore`.
   - Stub the API surface from §5.6 (TypeScript signatures only; bodies can
     throw `not-implemented` for `wait` / `unsubscribe` / `sendToSubagent`
     this ticket — later tickets fill them in):
     - `createPolicy(input)`, `createSubagent(input)`
     - `approve(id, by)`, `reject(id, reason)`,
       `markResolved(id, outcome)` — implement the state transitions + emit
       events for both kinds.
     - `get(id, chatId)`, `list(filter)`, `delete(id, chatId)`
     - `wipeAll()` delegates to the store.
   - In-memory map of pending subscriptions and sync-wait waiters keyed by
     chat — empty for now.

2. **New constant + emitter helper in `src/daemon/events.ts`:**
   ```ts
   export const DAEMON_EVENT_DELEGATION_RESOLVED = 'delegation-resolved';
   export interface DelegationResolvedEvent {
     chatId: string;
     delegation: Delegation;
   }
   export function emitDelegationResolved(ev: DelegationResolvedEvent) {
     daemonEvents.emit(DAEMON_EVENT_DELEGATION_RESOLVED, ev);
   }
   ```
   Wire `markResolved` to call it.

3. **Daemon startup wipe (additive only).** In the daemon entry point
   (`src/daemon/index.ts`) call `delegationManager.wipeAll()` once on boot,
   *in addition to* the existing cleanup paths. The legacy stores still
   exist; this just keeps the new tree clean.

### Tests

Unit tests under `src/daemon/delegation-manager.test.ts`:

- `createPolicy` + `createSubagent` persist records, both start in
  `pending` (when not auto-approved) or `running` (when caller passes
  `autoApprove: true`).
- `approve('user')` transitions `pending → running`; `reject('reason')`
  transitions `pending → rejected` and stamps `rejectionReason`.
- `markResolved({state: 'completed', executionResult})` transitions
  `running → completed`, sets `resolvedAt`, emits
  `DAEMON_EVENT_DELEGATION_RESOLVED` exactly once.
- `markResolved({state: 'failed'})` transitions `running → failed`.
- `wipeAll()` empties the tree.

No e2e tests — manager not exposed yet.

### Validation

`npm run validate` must pass.

---

## Ticket 2 — Migrate policy-request RPCs onto the manager

**Goal.** Replace `RequestStore` reads/writes inside policy RPCs and
`slash-policies.ts` with `DelegationManager`. Behavior is preserved 1:1:
auto-approved policies still run inline, `/approve` still kicks a fresh
turn with the script output, `/pending` still lists them.

**Spec.** §8 step 4. State retention on resolve (§2 row, §5.6 lifecycle
invariants).

### E2E tests (red first)

Add `e2e/policies/delegation-manager-policy.test.ts` (new file):

1. **`requests show` works after `/approve`.** Spawn a policy request,
   `/approve` it, then run `clawmini-lite.js delegations show <id>` (this
   command will exist after Ticket 6 — for now stub the test as
   `it.todo` if needed, *or* assert via the daemon's new
   on-disk file `.clawmini/tmp/delegations/<chatId>/<id>.json`). The
   resolved record must have `state: 'completed'`, `resolvedAt`, and
   `executionResult.stdout` containing the script output.

   > Today: `RequestStore.delete` removes the file on resolve. The new
   > behavior retains it.

2. **Auto-approved policy** writes a `state: 'completed'` record
   straight to the new tree without ever going through `pending`.

3. **Reject** writes `state: 'rejected'` with `rejectionReason` set.

4. **Existing tests stay green.** `e2e/policies/requests.test.ts`,
   `slash-policies.test.ts`, `policy-approval-anchor.test.ts`,
   `approval-session.test.ts` must continue to pass.

### Code

1. **`src/daemon/api/agent-policy-endpoints.ts`:** in
   `createPolicyRequest`, replace `new PolicyRequestService(new
   RequestStore(...))` with `delegationManager.createPolicy({...})`.
   - Preserve all input validation (file mappings, cwd, snapshotting via
     `createSnapshot`).
   - Reads the policy definition's `autoApprove` flag exactly as today.
   - For now, set `delivery: 'notify'` for all calls (the `delivery`
     input arrives in Ticket 5).

2. **`src/daemon/policy-request-service.ts`:** keep the file but reduce
   it to a pure executor — `execute(req): Promise<ResolvedOutcome>`
   that runs the script and returns `{stdout, stderr, exitCode}`. All
   storage moves to the manager. `DelegationManager.approve()` calls
   into this on the policy code path.

3. **`src/daemon/routers/slash-policies.ts`:** `/approve` and `/reject`
   load the record via `delegationManager.get(id)`, call
   `manager.approve(id, 'user')` / `manager.reject(id, reason)`, and
   emit the same chat message the user sees today (preview + result
   block). The “kick a fresh turn carrying output” path also moves under
   the manager — on `approve`, run script, `markResolved`, then call
   `executeDirectMessage` with the captured stdout as today.

4. **`/pending` lists from the manager** (filter `kind: 'policy'`,
   `state: 'pending'`).

5. **Delete `src/daemon/request-store.ts` and its test file.**
   Leave the `PolicyRequest` type in `src/shared/policies.ts` until
   Ticket 8 strips the last consumers; for this ticket, callers either
   convert to `PolicyDelegation` at the boundary or read the
   `executionResult` shape from the new record (it's identical).

### Validation

`npm run validate` must pass.

---

## Ticket 3 — Migrate subagent RPCs onto the manager

**Goal.** Replace `ChatSettings.subagents[id]` reads/writes inside the
subagent router with `DelegationManager`. `subagentSpawn`,
`subagentSend`, `subagentStop`, `subagentList`, `subagentTail`,
`subagentWait` all go through the manager.

**Spec.** §8 step 5. Subagent IDs become 3-char alphanumeric (today
they're UUIDs).

### E2E tests (red first)

Add `e2e/agents/delegation-manager-subagent.test.ts`:

1. **Spawn writes the new on-disk record**
   (`.clawmini/tmp/delegations/<chatId>/<id>.json`) with `kind:
   'subagent'`, `state: 'running'`, `targetAgentId`, `sessionId`,
   `prompt`.
2. **3-char ID format.** The id returned by `subagents spawn` matches
   `/^[0-9a-z]{3,}$/` (not a UUID).
3. **`subagents tail` still reads the subagent's history** (no
   behavioral change for the agent).
4. **`subagents send` updates `prompt` on the record** to the new
   message.
5. **Terminal status writes `state: 'completed' | 'failed'`** with
   `resolvedAt` set.
6. **`subagentWait` returns the completed result** (kept as a thin
   wrapper in this ticket; full removal happens in Ticket 6).
7. **`subagents stop` transitions to `state: 'failed'` with
   `rejectionReason` describing the abort.**

Existing `e2e/agents/subagent-lifecycle.test.ts`,
`subagents-depth.test.ts`, `subagent-authorization.test.ts`,
`session-timeout-subagents.test.ts` must continue to pass.

### Code

1. **`src/daemon/api/subagent-router.ts`:** all reads/writes route
   through `delegationManager`. `incrementSubagent` / `decrementSubagent`
   stay where they are. `assertSubagentAccess` becomes
   `delegationManager.assertVisibleTo(callerSubagentId, id, chatId)`
   with the same parent/child semantics — implement it in the manager
   using the new `parentId` field.
2. **Drop `ChatSettings.subagents` reads** from
   `src/daemon/routers/slash-policies.ts`,
   `agent-session.ts`, anywhere else that consults the tracker map.
   Replace with `delegationManager.get(id, chatId)`. The
   `ChatSettings.subagents` field in `src/shared/config.ts` is no
   longer written (we leave the schema field for one release so an
   old chat-settings.json doesn't fail validation; it's marked
   `// deprecated` and ignored).
3. **`subagentSpawn` accepts `delivery`** but defaults to today's
   behavior (`notify` for depth 0, `manual` for depth ≥ 1). The
   boolean `async` is mapped (`true → 'notify'`, `false → 'manual'`)
   and kept as a deprecated alias — the API still accepts it for one
   release. Same for `subagentSend`.
4. **`subagentWait` becomes a thin wrapper** that calls
   `delegationManager.wait({ids: [id], mode: 'any', return: 'sync',
   timeoutMs: 60_000})`. Implement the manager's `wait` for the
   single-id sync case here; the full multi-id/subscribe path lands in
   Ticket 5.

### Validation

`npm run validate` must pass.

---

## Ticket 4 — Approval gating for subagent spawn / send

**Goal.** Add the `subagents` rule list in `policies.json` and gate
`subagentSpawn` + `subagentSend` on it. Policy `autoApprove` remains
exactly as today.

**Spec.** §4 in its entirety (especially §4.2 built-in
`$self → $self`, §4.4 resolution, §7.5 walkthrough).

### E2E tests (red first)

Add `e2e/agents/subagent-approval.test.ts`:

1. **No rules, no built-in match** — `subagents spawn --agent
   other-agent ...` from `debug-agent` returns
   `{id, state: 'pending', requiresApproval: true}` and a
   `role: 'policy'`-style approval message lands in the chat. The
   subagent is *not* running until `/approve <id>` fires.
2. **`/approve <id>` transitions to running** and the subagent
   executes its prompt.
3. **`/reject <id> reason`** marks the delegation `rejected` with
   `rejectionReason` set; no subagent process starts.
4. **Built-in `$self → $self`** auto-approves spawning the same agent
   even with an empty rule list.
5. **A user rule `{from: '*', to: '*', autoApprove: true}`
   auto-approves anything.**
6. **First-match-wins** — a `{from: '$self', to: '$self', autoApprove:
   false}` user rule placed before the built-in disables self-clone.
7. **`subagents send` is also gated** — sending a new prompt across
   an unapproved edge enters `pending` exactly like spawn.
8. **Prefix matching** — a rule `{from: 'agents/coding', to:
   'agents/coding', autoApprove: true}` matches
   `agents/coding/coder-1 → agents/coding/coder-2`.

### Code

1. **New file `src/shared/approvals.ts`:**
   ```ts
   export interface SubagentRule {
     from: string;        // path | path prefix | '*' | '$self'
     to: string;
     autoApprove: boolean;
   }
   export const BUILTIN_SUBAGENT_RULES: SubagentRule[] = [
     { from: '$self', to: '$self', autoApprove: true },
   ];
   export function evaluateSubagentApproval(
     candidate: { fromPath: string; toPath: string },
     rules: SubagentRule[],
   ): boolean | null;   // null = no match (default false at caller)
   ```
   Implementation is pure: walk the resolved rule list
   `[...userRules, ...BUILTIN_SUBAGENT_RULES]`, first-match-wins, where
   a field "covers" a value if it equals it, is a path prefix of it,
   is `'*'`, or is `'$self'` (only matches when the candidate's path
   equals the spawner's).

2. **Extend the `policies.json` schema** in
   `src/shared/config.ts` (or `src/shared/policies.ts`, wherever
   `PolicyConfigFile` lives) to accept an optional
   `subagents: SubagentRule[]`. Update `readPoliciesForPath` to
   return it.

3. **`DelegationManager.createSubagent`** evaluates the rule list
   before persisting. On `false`/no-match, create a `pending` record
   and append an approval-preview chat message (modelled on the policy
   preview in `chats.ts`). On `true`, skip pending and go straight to
   `running`. On approval (via `/approve`), call the existing
   `executeSubagent` path.

4. **`DelegationManager.sendToSubagent`** runs the same rule
   evaluation against the *current* `agentId` and the target
   subagent's `targetAgentId`. On hold, persist a pending delegation
   for the send and only deliver the message after `/approve`.

5. **`/approve` and `/reject` already dispatch by id** (from Ticket
   2), so the existing slash-handlers automatically work for
   subagent-pending records too — just make sure the
   `manager.approve(id, 'user')` switch starts the subagent on the
   subagent code path.

6. **Unit tests** for `evaluateSubagentApproval` covering all match
   shapes (exact, prefix, `*`, `$self`, no-match) and ordering
   (override-before-builtin). Place in `src/shared/approvals.test.ts`.

### Validation

`npm run validate` must pass.

---

## Ticket 5 — Notify suppression + the `wait` core

**Goal.** Implement `DelegationManager.wait` for both `sync` and
`subscribe`, both `any` and `all` modes, including the
notification-suppression rule so `notify`-mode delegations covered by
an observer don't emit their own wakeups.

**Spec.** §5.2, §5.3 (valid combinations), §6 (waiting & subs), §8
steps 6–7.

### E2E tests (red first)

Add `e2e/agents/delegation-wait.test.ts`:

1. **Sync wait, single id.** Spawn a subagent with
   `--delivery manual`, then `delegations wait <id>` (added in Ticket
   6 — for now, hit the tRPC endpoint directly via the helper) blocks
   until completion and returns
   `{resolved: [{id, state: 'completed', ...}], pending: []}`.
2. **Sync wait, timeout.** A long-running subagent's wait with
   `--timeout 500` returns
   `{resolved: [], pending: [{id, state: 'running'}]}` and the
   delegation continues running. Its `delivery: 'manual'` means no
   wakeup fires later.
3. **Sync wait, mode `all`.** Spawn 3 subagents, wait `mode: 'all'`
   — wait returns only after the slowest finishes.
4. **Subscription, mode `all`.** Spawn 3 subagents
   (`--delivery manual`), register a subscription with `return:
   'subscribe', mode: 'all'`, exit the parent turn. When the last
   resolves, exactly one `<notification>` message lands in the chat
   summarizing all three.
5. **Notify suppression.** Spawn 3 subagents with `--delivery notify`,
   register a `subscribe` over them, mode `all`. When they all
   resolve, the chat receives **exactly one** notification (the
   subscription wakeup) — no per-id `<notification>` messages.
6. **Unsubscribe** discards the subscription without firing; covered
   members revert to their declared delivery (so a `notify` member
   that resolves after unsubscribe *does* append its individual
   `<notification>`).
7. **Mixed kinds.** Spawn 2 subagents + 1 auto-approved policy,
   subscribe on all 3 ids, mode `all`. The wakeup fires once
   summarizing all three; the resolved-set includes both kinds.
8. **Session-stamped notification.** Register a subscription, then
   `/new` the chat, then let the delegations resolve — the
   `<notification>` lands in the *original* session id, not the
   current one. (Use the chat's session log to assert which session
   the notification belongs to.)

### Code

1. **`DelegationManager.wait(opts)`** in
   `src/daemon/delegation-manager.ts`:
   - For `return: 'sync'`: register an in-memory waiter keyed by
     `(chatId, ids)`. Listen on `DAEMON_EVENT_DELEGATION_RESOLVED`.
     Return when `mode` is satisfied or `timeoutMs` elapses.
   - For `return: 'subscribe'`: persist a `Subscription` record under
     `.clawmini/tmp/delegations/<chatId>/subscriptions/<subscriptionId>.json`
     with `{subscriptionId, chatId, originSessionId, ids, mode,
     createdAt}`. Return `{subscriptionId}` immediately.
2. **On `markResolved`**, after emitting
   `DAEMON_EVENT_DELEGATION_RESOLVED`, check active observers:
   - If any waiter or subscription covers this id, suppress the
     delegation's own `delivery: 'notify'` wakeup for this resolution.
     Implement as: only append the per-id notification message if
     `delivery === 'notify'` AND no covering observer exists.
   - Update each covering observer: mark this id resolved. If the
     observer's `mode` is now satisfied, fire it (sync → resolve the
     RPC promise; subscribe → append the aggregated
     `<notification>`, delete the subscription file).
   - For subscribe `mode: 'any'`: when fired, *do not* discard
     suppression for the other ids — they revert to their declared
     `delivery`.

3. **`DelegationManager.unsubscribe(subscriptionId)`** deletes the
   subscription file, lifts suppression for any still-pending
   members (so future resolves of `notify` members produce normal
   wakeups), and does *not* append a notification.

4. **Subscription replay on daemon startup**: per spec ("cleared on
   daemon restart"), `wipeAll()` already removes the subscriptions
   directory — no replay needed.

5. **`appendNotification(chatId, sessionId, body)`** helper in the
   manager: appends a `system`-role `<notification>` message into the
   target session, mirroring today's subagent-completion notification
   in `subagent-router.ts`.

### Validation

`npm run validate` must pass.

---

## Ticket 6 — Agent-facing tRPC + CLI: `delegationWait`, `delegationList`, `delegationUnsubscribe`, `delegations` command group

**Goal.** Expose the manager to the agent via tRPC and add the
kind-agnostic `delegations` CLI group. Migrate the lite client off
`subagentWait` to `delegationWait`.

**Spec.** §5.1, §5.2, §5.4, §5.5 (especially the
`delegations` command-group table).

### E2E tests (red first)

Add `e2e/cli/delegations.test.ts`:

1. **`delegations list`** returns `pending` + `running` by default.
   Filter `--state resolved` returns resolved ones. Filter
   `--kind subagent` excludes policies, and vice versa. `--json`
   prints the raw records.
2. **`delegations wait <id>`** prints `{resolved: [...], pending:
   [...]}` for a single id (sync, default mode `any`, default 60s
   timeout).
3. **`delegations wait <a> <b> <c> --all`** waits until all three
   resolve.
4. **`delegations wait <a> <b> --subscribe`** prints
   `{subscriptionId: 'sub-...'}` and returns immediately. Later,
   when both ids resolve, a single `<notification>` appears in the
   chat log.
5. **`delegations notify-when <a> <b> --all`** is an alias for
   `delegations wait --subscribe --all`.
6. **`delegations unsubscribe <subscriptionId>`** removes the
   subscription file and prints `ok`. A second call returns
   non-zero.
7. **`delegations show <id>`** prints the full record (state,
   delivery, executionResult if resolved). Works for both kinds.
8. **`delegations delete <id>`** removes the record; if the
   delegation is a running subagent, it's also stopped. **Refuses
   while a subscription still covers the id** — error message
   "unsubscribe first".
9. **`subagents wait`, `subagents list`, `subagents delete`** are
   removed — invoking them prints "unknown command" (commander's
   default).

### Code

1. **New file `src/daemon/api/delegations-router.ts`** exposing
   `delegationWait`, `delegationList`, `delegationUnsubscribe`,
   `delegationShow`, `delegationDelete`. All backed by
   `delegationManager`. Mount these under the agent router.
2. **New file `src/cli/delegations-commands.ts`** registering the
   `delegations` Commander group; wire from `src/cli/lite.ts`.
3. **`src/cli/subagent-commands.ts`:** drop `wait`, `list`, `delete`.
   Replace the `do { … } while (status === 'active')` polling loop
   inside `spawn` and `send` with a single call to
   `client.delegationWait.mutate({ids: [id], mode: 'any', return:
   'sync'})`. Print the same human-readable output as today.
4. **`subagentList` tRPC endpoint stays** as a filtered view
   (`delegationList({kind: 'subagent'})`).

### Validation

`npm run validate` must pass.

---

## Ticket 7 — `--delivery` flag on `subagents spawn`, `subagents send`, and `request <cmd>`

**Goal.** Surface the `delivery` field at the CLI. Today's defaults
preserved.

**Spec.** §3.3 (defaults), §5.1 (creation API), §5.5 (CLI flags).

### E2E tests (red first)

Add to `e2e/agents/delegation-delivery.test.ts`:

1. **`subagents spawn --delivery notify`** (root agent) — on
   resolution, appends a `<notification>` to the chat (today's async
   behavior).
2. **`subagents spawn --delivery manual`** (root agent) — on
   resolution, *no* `<notification>` is appended. The result is
   observable via `delegations show <id>`.
3. **Default for root agent is `notify`** (no `--delivery` flag).
4. **Default for subagent (depth ≥ 1) is `manual`** — spawn from
   inside a subagent and assert no notification on completion.
5. **`request <cmd> --delivery manual`** (auto-approved policy)
   stores the result in the new record but does not append a
   `<notification>` to the chat; `delegations show <id>` returns the
   `executionResult`.
6. **`--async` boolean flag still works** on subagent spawn for one
   release (`true → notify`, `false → manual`), emits a deprecation
   warning on stderr.

### Code

1. **`src/cli/subagent-commands.ts`:** add `--delivery
   <manual|notify>`. If both `--async` and `--delivery` are passed,
   `--delivery` wins and a warning is printed.
2. **Policy CLI (the existing `request <cmd>` command, currently in
   `src/cli/manage-policies.ts` or wherever `request` is wired):**
   add `--delivery <manual|notify>`. Default `notify` (main) /
   `manual` (subagent).
3. **`subagentSpawn` / `subagentSend` / `createPolicyRequest`
   tRPC inputs** already accept `delivery` (Ticket 3 / Ticket 2);
   pass it through.
4. **Hint strings**. After spawn, print one extra line: `Use
   'clawmini-lite.js delegations wait <id>' or 'delegations
   notify-when <id>'.` for `--delivery manual`. After `request <cmd>
   --delivery manual`, print the same hint.

### Validation

`npm run validate` must pass.

---

## Ticket 8 — Skills + final cleanup

**Goal.** Update the skill manifests so agents see the new CLI in their
context, and remove the deprecated wrappers/aliases.

**Spec.** §8 step 9 (skill updates), §8 step 10 (daemon-start wipe is
the only wipe), step 11 (tests).

### E2E tests (red first)

Add `e2e/cli/skills-delegations.test.ts` (or extend
`e2e/cli/skills.test.ts`):

1. **`clawmini init` exports `clawmini-delegations` skill** into the
   workspace's `.agents/skills/` (or the configured `skillsDir`).
2. **`clawmini-subagents/SKILL.md`** mentions `--delivery` and the
   `delegations` group; no longer mentions `--async` as a primary
   flag, doesn't mention `subagents wait` / `list` / `delete`.
3. **`clawmini-requests/SKILL.md`** mentions `--delivery` and points
   at `delegations wait` / `show` for explicit observation.

### Code

1. **New skill: `templates/skills/clawmini-delegations/SKILL.md`**.
   Cover the mental model (one id space, one lifecycle, two kinds),
   the fan-out idiom (`--delivery manual` on creation +
   `delegations notify-when --all` for one aggregated wakeup), and
   the suppression rule. Cross-link to `clawmini-requests` and
   `clawmini-subagents`. Register it in the template manifest
   (`src/shared/template-manifest.ts`).
2. **Update `templates/skills/clawmini-subagents/SKILL.md`**:
   - Replace `--async` references with `--delivery manual|notify`
     (note the deprecated alias survives one release).
   - Drop `subagents wait`, `subagents list`, `subagents delete`
     sections; replace with one-line pointers to the `delegations`
     equivalents.
   - Add an approval-gating callout for `spawn` and `send`.
3. **Update `templates/skills/clawmini-requests/SKILL.md`**:
   - Document the new `--delivery manual|notify` flag.
   - Revise the "What Happens Next" section to mention
     `delegations wait` / `delegations show` as the explicit
     alternatives to wait-for-wakeup.
   - One-line note that the new `subagents` rule list in
     `policies.json` is user-managed (not reachable through
     `manage-policies`).
4. **Remove deprecated surfaces**:
   - Drop `--async` from `subagents spawn` and `subagents send` (now
     only `--delivery` works).
   - Drop `subagentWait` tRPC wrapper.
   - Drop `ChatSettings.subagents` from `src/shared/config.ts`
     entirely (no more deprecated field).
   - Drop the `RequestStore` type re-export (it was kept only for
     gradual migration).
5. **Drop daemon-start "mark active subagents failed" + "GC completed
   policy requests"** in favor of the unified
   `delegationManager.wipeAll()`. If those paths still exist in
   `src/daemon/index.ts` from Ticket 1, remove them.
6. **Update tests** in `e2e/agents/subagent-lifecycle.test.ts` and
   `e2e/agents/session-timeout-subagents.test.ts` to use
   `--delivery` instead of `--async` (the alias is gone). Replace any
   `subagents wait` / `list` / `delete` calls with the
   `delegations …` equivalents.

### Validation

`npm run validate` must pass. As a final smoke test, run the full
e2e suite (`npm run test` runs both unit and e2e under vitest); all
green.

---

## Out of scope

These are explicitly *not* covered by these tickets (matching the spec's
non-goals):

- Scheduler / concurrency rework.
- Web UI rework.
- Message-log unification.
- Job system changes (`clawmini-jobs/SKILL.md` is untouched).

## Cross-cutting reminders

- **Always run `npm run validate` after every ticket** — formatting,
  lint, typecheck, and tests must all pass. (Same bar your `MEMORY.md`
  enforces.)
- **Don't break existing tests** — every ticket above either adds new
  tests or preserves existing ones. If an existing test exercises
  removed surface (`subagents wait` etc.), update it in the same
  ticket that removes the surface.
- **Daemon restarts wipe `.clawmini/tmp/delegations/`** — never assume
  fan-out state survives a restart. Tests should isolate to a single
  daemon process via `TestEnvironment`.
- **Subagent IDs become 3-char alphanumeric** — anywhere a test
  hardcodes a UUID-shaped subagent id, update the matcher.
