# Subagents Feature Tickets

## Milestone 1: Core Storage and Path Resolution for Subagents
**Status:** Complete

**Tasks:**
- Update chat ID validation (`isValidChatId`) to support the `{parentChatId}:subagents:{subagentUuid}` format securely, preventing directory traversal.
- Update chat storage path resolution to map the new ID format to `chats/{parentChatId}/subagents/{subagentUuid}/`.
- Update chat deletion logic to cascade-delete `chats/{parentChatId}/subagents/` directories and abort their associated queues when a parent chat is deleted.

**Verification Steps:**
- Add unit tests for chat ID validation and path resolution with the nested format.
- Add unit tests verifying that deleting a parent chat cascade-deletes subagent directories and aborts their queues.
- Run `npm run validate` to ensure all checks pass.

## Milestone 2: Independent Subagent Execution and Bypassing Routers
**Status:** Complete

**Tasks:**
- Modify execution flow so that messages sent to a subagent ID bypass the standard `executeRouterPipeline` and directly invoke `executeDirectMessage`.
- Ensure each subagent runs on its own independent message queue context to prevent blocking the parent chat or other subagents.
- Implement the Completion Notification hook: once `executeDirectMessage` finishes for a subagent, automatically append a formatted summary message (with the result or error) to the parent chat.

**Verification Steps:**
- Add unit tests asserting that sending a message to a subagent directly invokes `executeDirectMessage` without triggering normal routers.
- Add unit tests verifying that when a subagent task completes or throws an error, a properly formatted completion message is appended to the parent chat.
- Run `npm run validate`.

## Milestone 3: TRPC Subagent Procedures
**Status:** Complete

**Tasks:**
- Create a new TRPC router for subagents (or extend the existing agent router) in the daemon API.
- Implement `subagentAdd`: creates a nested subagent chat, generates a UUID, and asynchronously starts execution.
- Implement `subagentList`: reads and lists the state of all subagents for a given parent chat.
- Implement `subagentTail`: returns recent messages/logs from a subagent's chat.
- Implement `subagentSend`: appends a message to the subagent and triggers execution.
- Implement `subagentStop`: aborts the specific subagent's active execution queue.
- Implement `subagentDelete`: aborts the queue and deletes the subagent's data directory.

**Verification Steps:**
- Add TRPC integration/unit tests for all new subagent procedures (`subagentAdd`, `subagentList`, `subagentTail`, `subagentSend`, `subagentStop`, `subagentDelete`).
- Run `npm run validate`.

## Milestone 4: CLI Interface (`clawmini-lite subagents`)
**Status:** Complete

**Tasks:**
- Add a new `subagents` command to the `clawmini-lite` CLI.
- Implement `add <message> [--agent <name>]` subcommand, utilizing the `subagentAdd` procedure.
- Implement `list` subcommand to display subagent info clearly.
- Implement `tail <id>` subcommand.
- Implement `send <id> <message>` subcommand.
- Implement `stop <id>` subcommand.
- Implement `delete <id>` subcommand.

**Verification Steps:**
- Add E2E tests for the new CLI subcommands to verify they correctly interact with the daemon's TRPC API.
- Run `npm run validate` to ensure formatting, linting, and all tests pass.

## Milestone 5: Code Quality & DRY Improvements (Identified in Review)
**Status:** Complete

**Tasks:**
- High: Fix DRY violation in `src/daemon/api/subagent-router.ts` by using `readSettings()` from `src/shared/workspace.ts` instead of manually reading and parsing `settings.json`.
- Medium: Fix DRY violation in `src/shared/workspace.ts` by reusing `getChatRelativePath` from `src/shared/chats.ts` instead of duplicating subagent ID parsing.
- Medium: Extract subagent chat ID parsing into a new helper `parseSubagentChatId` in `src/shared/chats.ts` and use it in `getChatRelativePath` and `src/daemon/message.ts` to replace raw `.split(':')` operations.

**Verification Steps:**
- Run `npm run validate` to ensure tests and type checking pass after refactoring.

## Milestone 6: Agent vs Subagent Execution Roles
**Status:** Complete

**Tasks:**
- Add checks in the TRPC routers for `jobs` and `log` endpoints using `isSubagentChatId`. If the caller is a subagent, reject the request with a clear error indicating subagents cannot schedule jobs or send direct logs.
- Update `subagentAdd` and `createPolicyRequest` (the underlying procedure for `request`) behavior based on the caller context:
  - If called by a main agent: return immediately with the ID (async execution). The `--async` flag does nothing.
  - If called by a subagent: block the response until the job completes, UNLESS `--async` is passed, in which case return the ID immediately.
  - *Ensure that returned IDs are uniquely identifiable (e.g., UUIDs) so they can be awaited universally.*
- Add a new `tasks` command to the `clawmini-lite` CLI.
- Implement `tasks pending` subcommand to fetch a list of unawaited policy requests or subagents for the active subagent session.
- Implement `tasks wait <id>` subcommand to allow a subagent to block and wait on a previously created asynchronous subagent or policy request.
- Add aliases `subagents wait <id>` and `request wait <id>` that route to `tasks wait <id>`.
- Add context check in the `wait` procedure: if the caller is a main agent, reject the request with a clear error indicating main agents cannot block via wait commands.
- Implement `AfterAgent` (or equivalent) hook verification logic in the execution flow. When a subagent stops executing, verify if there are any unawaited operations via `tasks pending` equivalents; if so, inject `{decision: "deny", reason: "must await ongoing..."}` to force the subagent to continue.
- Ensure subagent process cleanup correctly notifies the main agent of failure upon daemon restart.

**Verification Steps:**
- Add unit tests ensuring `jobs` and `log` TRPC calls fail when invoked from a subagent ID context.
- Add unit/E2E tests checking the synchronous vs asynchronous blocking behaviors for `request` and `subagents add` commands, parameterized by caller type (Agent vs Subagent).
- Add unit/E2E tests for `clawmini-lite tasks wait` and `tasks pending`.
- Add test asserting the hook verification successfully rejects subagent termination if unawaited tasks exist.
- Run `npm run validate` to ensure all checks pass.