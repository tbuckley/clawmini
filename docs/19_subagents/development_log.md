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

## Ticket 9: Logging and Web UI Integration
- Updated `src/daemon/message.ts` to accept an optional `subagentId` parameter in `executeDirectMessage` and pass it down to `createChatLogger`.
- Replaced manual `AgentSession` execution in `src/daemon/api/subagent-router.ts` for both `subagentSpawn` and `subagentSend` with `executeDirectMessage`. This explicitly logs incoming subagent messages to the chat history.
- Added `subagentId?: string` to `BaseMessage` in `web/src/lib/types.ts` and `src/shared/chats.ts`.
- Updated Svelte `filteredMessages` logic in `web/src/routes/chats/[id]/+page.svelte` to hide messages with a `subagentId` unless `appState.verbosityLevel` is set to `debug` or `verbose`. Added visual `[subagentId]` tags to both user and log messages in the Svelte template for when they are revealed.
- Updated `src/cli/commands/messages.ts` to filter out messages with a `subagentId` in the `messages tail` command.
- Updated `src/adapter-discord/forwarder.ts` to ignore any log messages with a `subagentId` before forwarding them to Discord.
- Verified all type, linting, and formatting checks pass with `npm run validate`.
- Marked Ticket 9 as complete.\n## Bug: Missing Output from Async Subagents\n\n### Reproducible Steps\n1. Run an async subagent.\n2. Observe the notification upon completion.\n3. Verify that the output is missing from the notification.\n4. Check if a tool like 'clawmini-lite.js subagents tail' exists.\n
\n### Solution\n1. Modified `src/daemon/api/subagent-router.ts` to include the output content of the last log message in the notification sent back to the parent agent when an async subagent completes.\n2. Added `clawmini-lite.js subagents tail <subagentId>` (and to the CLI `subagents` command via `src/cli/subagent-commands.ts`) to allow fetching subagent messages locally.\n3. Verified everything compiles and tests pass.\n
\n### Solution to `tail` context issue\n1. Removed `--chat` option from `clawmini-lite.js subagents tail` command.\n2. Added `subagentTail` RPC endpoint to `src/daemon/api/subagent-router.ts` so that the daemon automatically looks up the correct chat and session based on the provided token payload.\n3. Updated `src/cli/subagent-commands.ts` to use `client.subagentTail.query()`.\n4. Re-ran linter and tests to verify everything passes.
\n### Solution to Missing `subagentId` in Logs\n1. Found that `AgentSession` was not passing its `subagentId` to the fallback logger in its constructor, causing some logs to miss the ID.\n2. Identified that logs appended directly by `agent-router.ts` (e.g. via `logMessage`, policy auto-approve logs, and policy preview logs) were missing the `subagentId` from their context.\n3. Updated `src/daemon/agent/agent-session.ts` and `src/daemon/api/agent-router.ts` to ensure `subagentId` is correctly extracted from the token and included in the `CommandLogMessage`.\n4. Verified these updates with `npm run test` and committed the fix.
