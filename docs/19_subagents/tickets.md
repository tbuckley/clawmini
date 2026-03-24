# Subagents Feature Tickets

## Ticket 1: Core Data Structures & Settings

- **Description**: Update the foundational shared types to support subagents.
  - Add `subagentId?: string` to `BaseMessage` in `src/shared/chats.ts`.
  - Update `ChatSettingsSchema` in `src/shared/config.ts` to include a record or array for tracking subagents (including properties like `agentId`, `sessionId`, `createdAt`, `status`, and parent hierarchy).
- **Verification**:
  - Ensure type checks pass.
  - Run `npm run validate`.
- **Status**: complete

## Ticket 2: Chat Logger Scoping

- **Description**: Refactor the chat logging mechanism so subagents have isolated context.
  - Update `ChatLogger` (`src/daemon/agent/chat-logger.ts`) to support creating a "subagent view".
  - This view must transparently inject `subagentId` into outgoing messages and filter incoming logs so the subagent only reads its own context from `chat.jsonl`.
- **Verification**:
  - Add unit tests for `ChatLogger` ensuring the subagent view correctly filters and injects the ID.
  - Run `npm run validate`.
- **Status**: complete

## Ticket 3: Centralized Task Scheduler

- **Description**: Implement a robust concurrency manager to control agent execution across the daemon.
  - Create the Task Scheduler (e.g., in `src/daemon/agent/task-scheduler.ts`).
  - Enforce the global limit: `MAX_CONCURRENT_AGENTS = 5`.
  - Implement task queueing and resource lock maps (locked by directory path and workspace/root chat ID).
  - Implement starvation avoidance (processing oldest tasks first) and deadlock avoidance (temporary pool expansion if all active tasks are blocked waiting for subagents).
- **Verification**:
  - Add comprehensive unit tests covering scheduling, locking, deadlock detection/resolution, and priority queuing.
  - Run `npm run validate`.
- **Status**: complete

## Ticket 4: TRPC API Endpoints

- **Description**: Expose subagent management commands via the daemon's TRPC API.
  - Add new endpoints for: `spawn`, `send`, `wait`, `stop`, `delete`, and `list` subagents.
  - Wire these endpoints to interact with `ChatSettings` for persistence and the new Task Scheduler for execution.
- **Verification**:
  - Add unit/integration tests for the new TRPC routes.
  - Run `npm run validate`.
- **Status**: complete

## Ticket 5: CLI Interface (`clawmini-lite`)

- **Description**: Provide the interface for agents to manage subagents.
  - Update `src/cli/lite.ts` to include the new commands: `spawn`, `send`, `wait`, `stop`, `delete`, and `list`.
  - Implement parsing for flags like `--agent`, `--async`, and `--id`.
  - Connect the CLI commands to the newly created TRPC API endpoints.
- **Verification**:
  - Verify CLI command parsing and TRPC integration (via mock tests or e2e tests if available).
  - Run `npm run validate`.
- **Status**: complete

## Ticket 6: Agent Lifecycle & Execution Integration

- **Description**: Tie everything together in the agent's run loop.
  - Enforce the maximum hierarchy depth: `MAX_SUBAGENT_DEPTH = 2`.
  - Update the agent runner logic to submit execution tasks to the Task Scheduler rather than running them immediately.
  - Handle parent/child lifecycle: process asynchronous subagent completion notifications (e.g., `<notification>Subagent <id> completed...`) to wake up idle parent agents or queue them for busy ones.
  - Ensure subagents launch with a fresh default environment based on their specified `--agent`.
- **Verification**:
  - Add integration tests verifying full workflows: spawning a subagent, parent blocking/async notification, depth limits, and concurrent execution constraints.
  - Run `npm run validate`.
- **Status**: complete

## Ticket 7: Subagent Command & CLI Enhancements

- **Description**: Refine the CLI arguments and behavior for managing subagents.
  - Fix the `spawn` command signature to exclusively use `spawn "message" [--agent <name>] [--id <id>] [--async]` (removing the legacy `<name> [--prompt "message"]` format).
  - Add a `--pending` flag to the `list` command to filter for active/pending subagents.
  - Update the `list` command to output readable text by default, adding a `--json` flag to return a JSON array. For the readable text, avoid a table; prefer something like a title + property list for each subagent.
  - Enforce Main Agent Forced Async Behavior: Depth 0 (main agents) must completely ignore synchronous blocking requests (`--async=false`) and always execute as async internally.
- **Verification**:
  - Verify `list` outputs correct text or JSON based on flags.
  - Run `npm run validate`.
- **Status**: complete

## Ticket 8: Execution, Concurrency & Lifecycle Fixes

- **Description**: Clean up legacy execution layers and ensure proper process termination and state checks.
  - Remove the legacy per-directory `TaskQueue` wrapping execution to ensure subagents only rely on the Centralized Task Scheduler and don't block each other or their parent.
  - Update `stop()` and `interrupt()` to interface properly with the Centralized Task Scheduler. Ensure they only affect tasks associated with this AgentSession.
  - OS Process Cleanup: Update `stop` and `delete` logic to aggressively terminate underlying OS processes (e.g. killing background shell commands spawned by the subagent). They should get the relevant AgentSession and execute `stop()` on it.
  - Cascade Completion Logic: Prevent a parent from stopping while it still has pending children. Look at the AfterTool hook in gemini-claw/.gemini/settings.json for reference, and add an AfterAgent hook. The AfterAgent hook's script should run `clawmini-lite.js subagents list --json --pending` to get a list of any subagents still pending; and if it is not empty, it should output this message to force it to keep running: `{"decision": "deny", "reason": "You must wait for all subagents to complete with 'clawmini-lite.js subagents wait <id>'. Pending subagents: id1, id2, ..."}`. Of course, this should only occur for subagents (which must block) and not for main agents (which can block).
- **Verification**:
  - Verify subagents don't block parent or each other. Process termination verified via mock tests.
  - Run `npm run validate`.
- **Status**: complete

## Ticket 9: Logging and Web UI Integration

- **Description**: Improve the visibility and tracking of subagents within the chat and Web UI.
  - Direct Message Logging: Ensure spawning or sending a message to a subagent explicitly logs the incoming message to the chat (ideally utilizing `executeDirectMessage`).
  - Web UI Updates: Update the Web UI to hide subagent messages by default.
  - Web UI Updates: Ensure subagent messages are revealed only when the UI is in debug/verbose mode, providing a clear visual tag with the `subagentId`.
  - Discord adapter & CLI updates: Update adapter-discord and the `clawmini messages tail` CLI to ignore any messages associated with subagents.
- **Verification**:
  - Check the chat payload and Web UI rendering (default hidden vs debug visible).
  - Check the output of `clawmini messages tail` to ensure it ignores subagent messages.
  - Run `npm run validate`.
- **Status**: todo

## Ticket 10: Daemon Startup & Recovery

- **Description**: Implement graceful degradation for subagents when the daemon restarts.
  - Upon daemon startup, parse `ChatSettings` to identify any previously running/pending subagents.
  - Gracefully mark them as "failed" and notify the parent agent.
- **Verification**:
  - Test daemon restarts with active subagents to ensure they are properly marked failed.
  - Run `npm run validate`.
- **Status**: todo
