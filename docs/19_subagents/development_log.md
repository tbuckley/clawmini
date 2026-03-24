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
\n## Ticket 3: Centralized Task Scheduler\n- Created TaskScheduler in `src/daemon/agent/task-scheduler.ts` with a strict 5-concurrent agent limit.\n- Implemented queueing with oldest-task-first starvation avoidance.\n- Implemented deadlock avoidance. When tasks block waiting for subagents, they yield their concurrency slots AND their locks (dirPath and rootChatId locks) so subagents can execute and resolve the block.\n- Added comprehensive tests in `src/daemon/agent/task-scheduler.test.ts` to verify locks, starvation avoidance, deadlock resolution, and concurrency limits.\n- All checks passed successfully via `npm run validate`.
