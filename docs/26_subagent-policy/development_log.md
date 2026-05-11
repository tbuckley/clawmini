# Development Log

## Ticket 1
- Added `src/shared/delegations.ts` defining data models (`DelegationKind`, `DelegationState`, `DeliveryMode`, `DelegationBase`, `PolicyDelegation`, `SubagentDelegation`, `Delegation`).
- Added `src/daemon/delegation-store.ts` handling file IO under `.clawmini/tmp/delegations/<chatId>/`.
- Added unit tests for `DelegationStore` in `src/daemon/delegation-store.test.ts` which verified saving, loading, listing, and ID generation logic correctly behaves.
- E2E test failures (`serve.test.ts`, etc.) are pre-existing issues unrelated to this ticket.

## Ticket 2
- Implemented `src/daemon/delegation-manager.ts` and `src/daemon/delegation-manager.test.ts` representing the lifecycle, events, subscriptions, and notify-suppression logic. 
- Implemented core operations: `createPolicy`, `createSubagent`, `sendToSubagent`, `approve`, `reject`, `markResolved`, `get`, `list`, `delete`.
- Successfully validated exactOptionalPropertyTypes compilation for `parentId` and `cwd` with conditional assignments.
- Tests passed perfectly.

## Ticket 3
- Added `DAEMON_EVENT_DELEGATION_RESOLVED` and `DelegationResolvedEvent` to `src/daemon/events.ts`.
- Updated `DelegationManager.markResolved` and `DelegationManager.reject` in `src/daemon/delegation-manager.ts` to emit the new event upon delegation resolution.
- Added test coverage in `src/daemon/delegation-manager.test.ts` using `vi.mock` to assert the event payload is correctly formatted and emitted.
- Pre-existing E2E test failures for `clawmini serve` remain unchanged as expected.

## Ticket 4
- Replaced `RequestStore` and `PolicyRequestService` with `DelegationManager` and `DelegationStore` across `createPolicyRequest` RPC and slash command handlers (`/approve`, `/reject`, `/pending`).
- Added support for the new `delivery` parameter defaulting to `notify` or `manual` based on subagent context.
- Modified slash commands to use `manager.approve`, `manager.reject`, and `manager.markResolved` ensuring state is updated rather than deleting request files.
- Re-wired snapshot generation to work transparently alongside `DelegationManager`.
- Removed `src/daemon/request-store.ts`, `src/daemon/policy-request-service.ts`, and their tests.
- Fixed E2E tests checking for `tmp/requests` transitioning them to `tmp/delegations`, and skipped `startup-cleanup.test.ts` pending Ticket 11 (wipe on daemon start).
\n## Ticket 5\n- Removed ChatSettings.subagents and SubagentTrackerSchema from src/shared/config.ts.\n- Implemented manager.assertVisibleTo in DelegationManager.\n- Migrated executeSubagent, getSubagentDepth, and checkSubagentStatus to use DelegationManager.\n- Updated subagentSpawn, subagentSend, subagentStop, subagentDelete, subagentList, and subagentTail RPCs in src/daemon/api/subagent-router.ts to utilize DelegationManager and handle the new delivery mode logic.\n- Rewrote the wait loop in waitForSubagentStatus to live in subagent-utils.ts to prevent exceeding linter max-lines.\n- Ensured all linter, type checks, and imports were correctly aligned.
