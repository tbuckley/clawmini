# Development Log

## Completed Task: Milestone 1 - Core Storage and Path Resolution for Subagents

- Starting work on validating chat IDs and updating path resolution.
- Looking for `isValidChatId` and chat storage logic.
- Completed updating chat ID validation, path resolution, and cascade deletion.

## Completed Task: Milestone 2 - Independent Subagent Execution and Bypassing Routers

- Added `isSubagentChatId` utility.
- Updated `handleUserMessage` in `src/daemon/message.ts` to bypass router pipeline for subagents and execute them directly via `executeDirectMessage`.
- Modified `getMessageQueue` fetch in `executeDirectMessage` to use the subagent's absolute directory for isolation.
- Added a completion notification hook at the end of `queue.enqueue` to append success/failure status and output back to the parent chat.
- Fixed existing test mocks across `src/daemon/message-*.test.ts` to preserve `chats.js` module exports (specifically the newly added `isSubagentChatId`).
- Added tests in `src/daemon/message-subagent.test.ts` covering router bypassing and completion log messages.

## Completed Task: Milestone 3 - TRPC Subagent Procedures

- Created a new `subagent-router.ts` in `src/daemon/api`.
- Implemented `add`, `list`, `tail`, `send`, `stop`, `delete` procedures.
- Hooked up `subagentRouter` directly onto `userRouter` as a nested `subagents` property.
- Added comprehensive unit tests in `src/daemon/api/subagent-router.test.ts`.
- Validated with `npm run validate`.

## Completed Task: Milestone 4 - CLI Interface (`clawmini-lite subagents`)

- Added `subagents` command and subcommands (`add`, `list`, `tail`, `send`, `stop`, `delete`) to `src/cli/lite.ts` to be used by `clawmini-lite`.
- Exported `subagentRouter` in `AgentRouter` to expose subagents capabilities to spawned agents via the proxy API.
- Modified `initDaemon` in `src/daemon/index.ts` to update `settings.json` with the assigned dynamic port when `apiCtx.port` is `0`, fixing `EADDRINUSE` failures in parallel e2e tests where multiple daemons allocate a random port.
- Added E2E tests in `src/cli/e2e/subagents-lite.test.ts` to verify the functionality of `clawmini-lite subagents`.
- Verified changes with `npm run validate`.

## Bug Fixes: Policy Routing and Subagent Completion Messages

### Hypotheses & Exploration:
- **Policy Routing:** Policy requests were being sent to the subagent's chat, not the parent chat, making them invisible to the user. I hypothesized that `loadAndValidateRequest` and `createPolicyRequest` needed to resolve the parent/root chat ID of a subagent.
- **Completion Messages:** Subagent completion messages were appended as `CommandLogMessage`s (`role: 'log'`), which only displays output but doesn't trigger the parent agent to process the result. I hypothesized that we needed to use `handleUserMessage` (with `noWait: true`) to inject a user message and trigger the parent agent so it acts on the subagent's result.

### Implementation:
- Implemented `getRootChatId` in `src/shared/chats.ts` to parse nested subagent chat IDs.
- Updated `src/daemon/api/agent-router.ts`'s `createPolicyRequest` to use `getRootChatId(chatId)` when creating the `CommandLogMessage` preview in the parent chat.
- Modified `src/daemon/routers/slash-policies.ts` to use `getRootChatId` in `loadAndValidateRequest` to correctly match the user's root chat to the subagent's request.
- **Critical Architecture Update:** The `slashPolicies` router previously tried to hijack the entire execution pipeline by replacing `state.chatId` with the subagent's ID. This caused the user's `/approve` message to disappear from the root chat. I updated `RouterState` with a new `redirects` array property. The router now returns `redirects` with the subagent payload and `action: 'stop'` to correctly route the user's `/approve` message and system replies to the root chat, while safely passing the execution outcome to the subagent's queue loop in `handleUserMessage`.
- Replaced the direct `appendMessage` of the `subagent-completion` `CommandLogMessage` with a call to `executeDirectMessage` (in `src/daemon/message.ts`). This safely queues a silent `isSystemCompletion` execution to the parent chat, natively triggering the parent agent asynchronously (`noWait: true`) to process the subagent output as an agent execution cycle without confusing the message timeline.
- Fixed corresponding unit tests in `src/daemon/message-subagent.test.ts` and `src/daemon/api/policy-request.test.ts` to match the correct `role` and queue logic.
- Ran validation tools (`npm run validate`) and fixed Prettier and TypeScript check errors. All checks pass perfectly.

## Completed Task: Milestone 6 - Agent vs Subagent Execution Roles

- Added validation checks in `agentListCronJobs`, `agentAddCronJob`, `agentDeleteCronJob`, and `logMessage` TRPC endpoints in `agent-router.ts` to reject subagent invocations.
- Updated `subagentAdd` and `createPolicyRequest` to asynchronously return immediately for main agents, but block waiting for task completion for subagents, correctly adhering to the `--async` override parameter.
- Implemented polling mechanism on `store.load` and `isSessionIdActive` to correctly block waiting on policies and subagents.
- Added a new CLI `tasks pending` command, listing all unawaited asynchronous tasks for the active session.
- Added a new CLI `tasks wait <id>` command, enabling a subagent to block and wait on pending tasks. Added alias `subagents wait` and CLI level routing from `request wait` to `tasks wait`.
- Added the `tasks` TRPC router mapped into `agentRouter`.
- Intercepted subagent termination (`subagent-completion` in `executeDirectMessage`) to automatically deny completion and append `decision: "deny"` if unawaited async tasks are detected.
- Added `cleanupDeadSubagents()` execution to `initDaemon()` in `src/daemon/index.ts` on daemon boot. This identifies stranded subagents that were terminated abruptly (e.g. Daemon restart) and gracefully fails them with a completion message so the main agent isn't blocked forever.
- Addressed Prettier and linting type errors.
- Refactored `RequestStore` mock in `message-subagent.test.ts` to prevent test failures on `EPERM` or `ENOENT` directory path accesses. All tests pass with 100% success using `npm run validate`.
