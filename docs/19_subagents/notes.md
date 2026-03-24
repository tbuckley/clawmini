# Subagents Research Notes

## Current State

- **`BaseMessage`** is defined in `src/shared/chats.ts`. It includes `id`, `role`, `content`, `timestamp`. We will need to add an optional `subagentId?: string` property to differentiate messages in the `chat.jsonl`.
- **`ChatSettings`** is defined in `src/shared/config.ts` (`ChatSettingsSchema`). It currently holds `defaultAgent`, `sessions`, `routers`, `jobs`. We will need to add a `subagents` record or array here to track subagent state (`agentId`, `sessionId`, `createdAt`, `status`, etc.).
- **`clawmini-lite`** is defined in `src/cli/lite.ts` as a standalone client using TRPC to communicate with the daemon. We will need to add new commands: `spawn`, `send`, `wait`, `stop`, `delete`, `list`.
- **API** uses TRPC. We will need new TRPC endpoints in the daemon API to handle these commands.
- **`ChatLogger`** is created via `createChatLogger` in `src/daemon/agent/chat-logger.ts`. We will need to add a way to create a "subagent view" of a logger that automatically injects and filters by `subagentId`.
- **Concurrency & Limits**: We need to enforce `MAX_SUBAGENT_DEPTH=2` and `MAX_CONCURRENT_AGENTS=5`. This likely needs to be tracked globally across the clawmini instance (perhaps in the daemon state).

## Key Workstreams
1. Update types (`BaseMessage`, `ChatSettings`).
2. Implement daemon state tracking for subagents (active count, depth).
3. Create TRPC API endpoints for subagent management.
4. Implement `clawmini-lite` CLI commands.
5. Update `ChatLogger` to support subagent scoping.
6. Handle subagent execution lifecycle (spawn, run, complete, notify/wait, stop).
