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