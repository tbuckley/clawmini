# Tickets: Unified Delegation (Subagent Policy V2)

## Ticket 1: Introduce `Delegation` schema and `DelegationStore`
**Status:** Complete

**Description:**
Implement the unified data models and file-system persistence layer that will replace both `RequestStore` (policy requests) and `ChatSettings.subagents`.
- Add `src/shared/delegations.ts` defining `DelegationKind`, `DelegationState`, `DeliveryMode`, `DelegationBase`, `PolicyDelegation`, `SubagentDelegation`, and `Delegation`.
- Add `src/daemon/delegation-store.ts` handling file IO under `.clawmini/tmp/delegations/<chatId>/`.

**Verification:**
- Add unit tests for `delegation-store.ts`.
- Run `npm run validate`.

---

## Ticket 2: Add `DelegationManager` (Lifecycle & Event Foundation)
**Status:** Complete

**Description:**
Implement the central controller for delegations. This acts as the cross-kind owner of lifecycle, events, subscriptions, and notify-suppression.
- Create `src/daemon/delegation-manager.ts`.
- Implement `createPolicy`, `createSubagent`, `sendToSubagent`, `approve`, `reject`, `markResolved`, `get`, `list`, `delete`.
- Note: Actual execution dispatch to `PolicyRequestService` and `executeSubagent` will be wired up in later tickets, but the method signatures and state transitions should be stubbed out.

**Verification:**
- Add unit tests for `delegation-manager.ts` state transitions.
- Run `npm run validate`.

---

## Ticket 3: Add `DAEMON_EVENT_DELEGATION_RESOLVED`
**Status:** Complete

**Description:**
Introduce the new daemon event used to signal completion of either a policy request or a subagent.
- Add `DAEMON_EVENT_DELEGATION_RESOLVED` to `src/daemon/events.ts`.
- Update `manager.markResolved` to emit this event.
- Ensure the wait/subscribe paths (to be implemented) can listen to this event instead of scraping `DAEMON_EVENT_MESSAGE_APPENDED`.

**Verification:**
- Add unit tests verifying event emission in `delegation-manager.ts`.
- Run `npm run validate`.

---

## Ticket 4: Migrate Policy-Request RPCs and Handlers
**Status:** Complete

**Description:**
Switch policy requests to use the new `DelegationManager` instead of `RequestStore`.
- Update `createPolicyRequest` RPC to use `manager.createPolicy()` and accept the new `delivery` parameter (default `notify` for main agents, `manual` for subagents).
- Update `slash-policies.ts` handlers (`/approve`, `/reject`) to call `manager.approve()` and `manager.reject()`.
- Move the policy script execution path inside the `/approve` handler to run under `manager.approve()`'s per-kind dispatch.
- Ensure resolved requests transition state in place instead of being deleted.

**Verification:**
- Update tests in `policy-request.test.ts` and `slash-policies.test.ts`.
- Run `npm run validate`.

---

## Ticket 5: Migrate Subagent RPCs
**Status:** Complete

**Description:**
Switch subagents to use the new `DelegationManager` instead of `ChatSettings.subagents`.
- Update `subagentSpawn`, `subagentSend`, `subagentStop`, `subagentList`, `subagentTail` RPCs to read/write through the manager.
- Drop `ChatSettings.subagents`.
- Add `delivery` to `spawn` and `send`. Deprecate `async` (map `true` to `notify` and `false` to `manual`).
- Update parent/child access check to use `manager.assertVisibleTo`.
- Change Subagent IDs to the 3-char alphanumeric format.

**Verification:**
- Update tests in `subagent-router.test.ts`.
- Run `npm run validate`.

---

## Ticket 6: Implement Unified Wait API
**Status:** Not Started

**Description:**
Expose the unified wait functionality on the agent-facing tRPC surface.
- Add `delegationWait`, `delegationList`, `delegationUnsubscribe` to the tRPC surface, backed by the manager.
- Update `subagentWait` to be a thin wrapper around `manager.wait({ids: [id], mode: 'any', return: 'sync'})` (keep for one release for backward compatibility).

**Verification:**
- Add unit tests for `delegationWait` covering any/all, sync/subscribe, mixed kinds, unsubscribe, and session-stamped notification.
- Run `npm run validate`.

---

## Ticket 7: Implement Notify Suppression
**Status:** Not Started

**Description:**
Ensure `notify` delivery mode does not cause double wakeups when a subscription or sync wait covers the delegation.
- Implement notify suppression in `DelegationManager`.
- When a delegation is covered by a pending sync wait or unfired subscription, suppress its `notify` at `markResolved` time.
- When the observer resolves or cancels, lift suppression for any still-pending members.

**Verification:**
- Add unit tests in `delegation-manager.test.ts` to explicitly verify suppression rules.
- Run `npm run validate`.

---

## Ticket 8: Add Subagent Approval Rules
**Status:** Not Started

**Description:**
Implement the approval gating for subagent spawn and send operations.
- Add `src/shared/approvals.ts` defining `SubagentRule`, `BUILTIN_SUBAGENT_RULES` (including `$self -> $self`), and `evaluateSubagentApproval(candidate, rules)`.
- Support the optional `subagents` array in `policies.json`.
- Gate `manager.createPolicy`, `manager.createSubagent`, and `manager.sendToSubagent` by running the matcher.

**Verification:**
- Add unit tests for `approvals.ts` verifying rule evaluation, built-in override by placement, etc.
- Run `npm run validate`.

---

## Ticket 9: Update Agent CLI Commands (`clawmini-lite`)
**Status:** Not Started

**Description:**
Refactor the CLI commands to align with the new kind-agnostic observation and kind-specific creation philosophy.
- Update `cli/subagent-commands.ts`: call `delegationWait` (drop polling loop), remove `subagents wait / list / delete`. Update output hints.
- Create `cli/delegations-commands.ts` with `delegations list`, `wait`, `notify-when`, `unsubscribe`, `show`, `delete`.
- Register the new command group in `cli/lite.ts`.
- Update `request <cmd>` command to support `--delivery manual|notify` and update output hints.

**Verification:**
- Run relevant e2e tests or add CLI tests if applicable.
- Run `npm run validate`.

---

## Ticket 10: Update Built-in Skills
**Status:** Not Started

**Description:**
Update the system prompts and skill guides in `templates/skills/` to reflect the new API and commands.
- Update `clawmini-requests/SKILL.md` with `--delivery` usage and pointers to `delegations wait/show`.
- Update `clawmini-subagents/SKILL.md` to replace `--async` with `--delivery`, remove deprecated commands, and explain approval-gating.
- Create new `clawmini-delegations/SKILL.md` introducing the `delegations` command group, the shared ID space, fan-out idioms, and suppression rules.

**Verification:**
- Review markdown changes for clarity and correctness.
- Run `npm run validate`.

---

## Ticket 11: Implement Daemon-Start Wipe
**Status:** Not Started

**Description:**
Ensure the daemon starts with a clean slate regarding delegations.
- Implement `manager.wipeAll()` to delete the entire `.clawmini/tmp/delegations/` tree.
- Call `manager.wipeAll()` on daemon start, replacing the previous logic ("mark active subagents failed" & "GC completed policy requests").

**Verification:**
- Add test verifying `wipeAll` deletes the directory contents.
- Run `npm run validate`.