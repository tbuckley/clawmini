# Subagents Feature Notes

## Current Architecture
- `clawmini-lite` is the CLI tool used by agents. It uses a TRPC client to communicate with the daemon.
- The daemon exposes procedures via `src/daemon/api/agent-router.ts`.
- Chats are stored in `<workspace>/.gemini/chats/<chatId>/chat.jsonl`.
- `executeDirectMessage` in `src/daemon/message.ts` handles running an agent without going through the router pipeline.
- `handleUserMessage` passes messages through routers before calling `executeDirectMessage`.
- `isSubagentChatId` from `src/shared/chats.ts` is used to distinguish subagent chat contexts from main agents.

## Requirements
- `clawmini-lite.ts subagents` with subcommands:
  - `add "message" [--agent name] [--async]` -> Spawns subagent. Main agents never block. Sub-agents block by default unless `--async` is specified. Returns `{uuid}`.
  - `list` -> Shows all running subagents.
  - `tail {id}` -> Shows recent messages/logs for the subagent's chat.
  - `delete {id}` -> Deletes the subagent's chat and kills the agent if it's running.
  - `stop {id}` -> Stops anything the agent is doing (interrupts).
  - `send {id} "message"` -> Appends a new message to the subagent.
  - `wait {id}` -> Subagents use this to block on asynchronous subagent tasks.
- Storage path: `chats/<parentChatId>/subagents/<uuid>/chat.jsonl`.
- Bypassing Routers: Messages sent to subagents should use `executeDirectMessage` directly, avoiding the `executeRouterPipeline` step in `handleUserMessage`.
- Completion notification: When the subagent's execution completes, an automatic message must be appended to the parent chat with the results.

### Agent vs Subagent Capabilities
- **Jobs:** Main agents can schedule tasks (`clawmini-lite.js jobs`). Sub-agents cannot and must receive an error.
- **Logging:** Main agents can send messages (`clawmini-lite.js log`). Sub-agents cannot and must receive an error.
- **Blocking/Async behavior (`subagents add`, `request`):**
  - **Main Agent:** Never blocks. Commands return immediately with an ID. The `--async` flag is ignored as they are always async.
  - **Subagent:** Blocks by default. Subagents can specify `--async` to get an ID but must eventually block via `wait` (e.g. `clawmini-lite.js subagents wait <id>`).
- **Fetch Ongoing:** A new command `fetch-ongoing` returns policy requests or subagents not yet awaited by the subagent.
- **Hook Enforcement:** A hook (e.g. `AfterAgent` in Gemini CLI) will watch if a subagent tries to stop without awaiting its asynchronous tasks. It will force the subagent to continue, reminding it to await them via `{decision: "deny", reason: "..."}`.

## Implementation Details
1. **Daemon TRPC Procedures**: Add mutations/queries in `agent-router.ts` (or a new `subagent-router.ts`):
   - `subagentAdd`: Creates the nested chat, generates a UUID, and kicks off `executeDirectMessage`. Execution sync/async behavior depends on context (Agent vs Subagent).
   - `subagentWait`: Allows subagents to block on a specific ID.
   - `fetchOngoing`: Retrieves unawaited requests/subagents for the current subagent.
   - Restoring existing operations (`list`, `tail`, `delete`, `stop`, `send`).
2. **Access Control**: Use `isSubagentChatId(chatId)` in TRPC procedures (or middleware) to explicitly deny `jobs` and `log` requests if the caller is a subagent.
3. **Queue / Concurrency**: Subagent must have its own sessionId. `executeDirectMessage` handles concurrency.
4. **Enforcing Await**: Integrate with hooks or completion logic to check if a subagent has unawaited tasks (using state persisted in the daemon). Return denial instructions if true.
