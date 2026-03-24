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
- **Status**: not started
