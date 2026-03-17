# Subagents Feature Tickets

## Milestone 1: Core Storage and Path Resolution for Subagents
**Status:** Not Started

**Tasks:**
- Update chat ID validation (`isValidChatId`) to support the `{parentChatId}:subagents:{subagentUuid}` format securely, preventing directory traversal.
- Update chat storage path resolution to map the new ID format to `chats/{parentChatId}/subagents/{subagentUuid}/`.
- Update chat deletion logic to cascade-delete `chats/{parentChatId}/subagents/` directories and abort their associated queues when a parent chat is deleted.

**Verification Steps:**
- Add unit tests for chat ID validation and path resolution with the nested format.
- Add unit tests verifying that deleting a parent chat cascade-deletes subagent directories and aborts their queues.
- Run `npm run validate` to ensure all checks pass.

## Milestone 2: Independent Subagent Execution and Bypassing Routers
**Status:** Not Started

**Tasks:**
- Modify execution flow so that messages sent to a subagent ID bypass the standard `executeRouterPipeline` and directly invoke `executeDirectMessage`.
- Ensure each subagent runs on its own independent message queue context to prevent blocking the parent chat or other subagents.
- Implement the Completion Notification hook: once `executeDirectMessage` finishes for a subagent, automatically append a formatted summary message (with the result or error) to the parent chat.

**Verification Steps:**
- Add unit tests asserting that sending a message to a subagent directly invokes `executeDirectMessage` without triggering normal routers.
- Add unit tests verifying that when a subagent task completes or throws an error, a properly formatted completion message is appended to the parent chat.
- Run `npm run validate`.

## Milestone 3: TRPC Subagent Procedures
**Status:** Not Started

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
**Status:** Not Started

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