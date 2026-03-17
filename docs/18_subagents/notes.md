# Subagents Feature Notes

## Current Architecture
- `clawmini-lite` is the CLI tool used by agents. It uses a TRPC client to communicate with the daemon.
- The daemon exposes procedures via `src/daemon/api/agent-router.ts`.
- Chats are stored in `<workspace>/.gemini/chats/<chatId>/chat.jsonl`.
- `executeDirectMessage` in `src/daemon/message.ts` handles running an agent without going through the router pipeline.
- `handleUserMessage` passes messages through routers before calling `executeDirectMessage`.

## Requirements
- `clawmini-lite.ts subagents` with subcommands:
  - `add "message" [--agent name]` -> Returns the `{uuid}` of the subagent.
  - `list` -> Shows all running subagents.
  - `tail {id}` -> Shows recent messages/logs for the subagent's chat.
  - `delete {id}` -> Deletes the subagent's chat and kills the agent if it's running.
  - `stop {id}` -> Stops anything the agent is doing (interrupts).
  - `send {id} "message"` -> Appends a new message to the subagent.
- Storage path: `chats/<parentChatId>/subagents/<uuid>/chat.jsonl`.
- Bypassing Routers: Messages sent to subagents should use `executeDirectMessage` directly, avoiding the `executeRouterPipeline` step in `handleUserMessage`.
- Completion notification: When the subagent's execution completes, an automatic message must be appended to the parent chat with the results.

## Implementation Details
1. **Daemon TRPC Procedures**: Add mutations/queries in `agent-router.ts` (or a new `subagent-router.ts`):
   - `subagentAdd`: Creates the nested chat, generates a UUID, and kicks off `executeDirectMessage` asynchronously. Once done, appends a message back to the parent chat.
   - `subagentList`: Lists directories in `chats/<parentChatId>/subagents/`.
   - `subagentTail`: Reads the last few messages from the subagent's `chat.jsonl`.
   - `subagentDelete`: Deletes the directory and calls `queue.abortCurrent()` for the subagent's chat.
   - `subagentStop`: Calls `queue.abortCurrent()` for the subagent.
   - `subagentSend`: Appends a message and triggers `executeDirectMessage` for the subagent.
2. **Path Resolution**: `chats.ts` currently expects a flat `chatId`. We need to ensure that nested chat IDs like `foo/subagents/uuid` are supported or handled gracefully.
3. **Queue / Concurrency**: `getMessageQueue(cwd)` currently keys off `cwd`. Wait, does it key off `chatId`? No, `getMessageQueue` is global per daemon or per workspace. Actually, queue is per workspace root? Let's check `queue.ts`. But in `message.ts`: `const queue = getMessageQueue(cwd)`. Let me double-check `queue.ts` via `read_file` if needed, but it seems there's a queue that can be aborted by sessionId. We should ensure the subagent has its own sessionId so it can be stopped independently.