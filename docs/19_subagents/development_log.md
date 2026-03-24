# Development Log - Subagents

## Ticket 1: Core Data Structures & Settings
- Starting work on adding `subagentId` to `BaseMessage` in `src/shared/chats.ts`.
- Updating `ChatSettingsSchema` in `src/shared/config.ts` to include subagent tracking.
- Completed Ticket 1 successfully. All tests and checks pass.

## Ticket 2: Chat Logger Scoping
- Reading `ChatLogger` (`src/daemon/agent/chat-logger.ts`) to understand how to implement `subagent view`.
- Checking existing tests for `ChatLogger`.
- Implemented `getMessages` in the `Logger` interface to support context filtering.
- Updated `createChatLogger` to support a `subagentId` and filter/inject it.
- Added comprehensive unit tests in `src/daemon/agent/chat-logger.test.ts`.
- Ran `npm run validate` and all checks passed.

## Ticket 3: Centralized Task Scheduler
- Created TaskScheduler in `src/daemon/agent/task-scheduler.ts` with a strict 5-concurrent agent limit.
- Implemented queueing with oldest-task-first starvation avoidance.
- Implemented deadlock avoidance. When tasks block waiting for subagents, they yield their concurrency slots AND their locks (dirPath and rootChatId locks) so subagents can execute and resolve the block.
- Added comprehensive tests in `src/daemon/agent/task-scheduler.test.ts` to verify locks, starvation avoidance, deadlock resolution, and concurrency limits.
- All checks passed successfully via `npm run validate`.

## Ticket 4: TRPC API Endpoints
- Investigated agent TRPC routing in `src/daemon/api/agent-router.ts`.
- Exposed a singleton `taskScheduler` from `src/daemon/agent/task-scheduler.ts`.
- Added a new file `src/daemon/api/subagent-router.ts` for handling `spawn`, `send`, `wait`, `stop`, `delete`, and `list` endpoints.
- Integrated the endpoints by importing them into `src/daemon/api/agent-router.ts`.
- Fixed ESLint file-size max lines errors by modularizing the subagent router correctly.
- Addressed TypeScript typing errors for `settings.subagents` non-null indexing.
- Verified everything with `npm run validate` (all checks passed successfully).
- Marked Ticket 4 as complete.

## Ticket 5: CLI Interface (`clawmini-lite`)
- Extracted subagent commands logic to a new file `src/cli/subagent-commands.ts` to keep `src/cli/lite.ts` concise and adhere to `max-lines` ESLint rule.
- Added `subagents` group to `clawmini-lite` with subcommands: `spawn`, `send`, `wait`, `stop`, `delete`, and `list`.
- Wired the CLI commands directly to the TRPC AppRouter (`subagentSpawn`, `subagentWait`, etc.).
- Verified `npm run validate` and all tests/formatting passed successfully.
- Marked Ticket 5 as complete.

## Ticket 6: Agent Lifecycle & Execution Integration
- Updated `AgentSession.handleMessage` to wrap execution in `taskScheduler.schedule` to enqueue to the global task limits rather than running immediately.
- Updated `subagentSpawn` inside `src/daemon/api/subagent-router.ts` to enforce `MAX_SUBAGENT_DEPTH = 2` by walking the `parentId` chain.
- Refactored `subagentSpawn` and `subagentSend` to asynchronously instantiate an `AgentSession` and call `.handleMessage()`, which automatically delegates task execution to the TaskScheduler.
- Implemented subagent completion notifications by automatically appending a `<notification>` message to the parent agent upon completion in `subagentSpawn`.
- Fixed several TypeScript errors and unused import lint warnings in `subagent-router.ts`.
- Addressed failing tests in `src/daemon/message-queue.test.ts` caused by `taskScheduler` retaining locks across tests by correctly calling `.finish()` on mocked emitters and increasing test timeouts.
- Ran `npm run validate` which executed flawlessly.
- Marked Ticket 6 as complete.

## Ticket 7: Subagent Command & CLI Enhancements
- Updated `src/cli/subagent-commands.ts` to change the `spawn` command signature to use positional `message` rather than `targetAgentId`.
- Added `--agent`, `--id`, and `--async` flags to the `spawn` command.
- Updated `src/daemon/api/subagent-router.ts` to optionally accept `targetAgentId` and gracefully default to `'default'`.
- Ensured the `subagentSpawn` TRPC endpoint returns `depth` so the CLI can conditionally block on subagent execution unless `--async` is passed or `depth === 0`. Main agents are forced to be async.
- Updated the `list` command to accept `--pending` and `--json` options. Default output now produces a formatted property list instead of an unstructured JSON payload.
- Verified everything with `npm run validate` and all tests/checks passed.
- Marked Ticket 7 as complete.

## Ticket 8: Execution, Concurrency & Lifecycle Fixes
- Updated TaskScheduler to natively support aborting (via AbortController) and interrupting tasks by sessionId.
- Removed the legacy per-directory Queue (getMessageQueue) dependency from AgentSession.
- Updated AgentSession to directly use taskScheduler for all task execution, stop(), and interrupt().
- Refactored fetchPendingMessages to use taskScheduler.extractPending instead of getMessageQueue.
- Fixed mock usages of getMessageQueue in testing files (message-interruption.test.ts, message-typing.test.ts, api/index.test.ts) to correctly use taskScheduler.
- Handled ESLint warnings (avoiding any types and fixing no-unused-vars) in src/cli/subagent-commands.ts and src/daemon/api/agent-router.ts.
- Added AfterAgent hook to templates/gemini-claw/.gemini/settings.json that executes a newly created Node script: check-subagents.mjs.
- check-subagents.mjs enforces cascade completion by extracting CLAW_API_TOKEN, checking for running subagents that belong to the current agent, and blocking completion using the "deny" decision protocol.
- Verified everything with npm run validate.
- Marked Ticket 8 as complete.