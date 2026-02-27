# Notes: Routers Feature

## Current Architecture
- **Messages**: Users send messages through the CLI (`cli/client.ts` or `daemon/router.ts`), which get processed by `daemon/message.ts`.
- **Agents**: Agents handle messages. Each agent has its own `new` and `append` command. Agents might be assigned by default or manually overridden.
- **Sessions**: Chat instances maintain sessions, and an agent can have multiple sessions in a chat.
- **Config Files**: Settings live in `.clawmini/settings.json` (global workspace) and `.clawmini/chats/ID/settings.json` (per-chat).

## Router Concept
A router acts as a middleware pipeline that intercepts the user's message before it's passed to the queue for the agent to process.
- **Input**: `{ message: string, chatId?: string, agentId?: string, sessionId?: string, env?: object }` (or similar JSON representation of current state).
- **Output**: Returns a JSON object specifying modifications.
- **Built-in Routers**:
  - `@clawmini/slash-new`: Detects `/new` prefix. Modifies `sessionId` to a new random UUID.
  - `@clawmini/slash-command`: Detects slash prefixes (e.g. `/foo`) and replaces the command with file content from `.clawmini/commands/foo.md`.

## Execution Flow
1. User sends message `M1`.
2. System loads defined `routers` array from local chat `settings.json`, falling back to global `settings.json`.
3. For each router `R` in `routers`:
   - System invokes `R` (likely spawning a subprocess, or handling natively if built-in).
   - `R` receives `{ message: "...", ... }` via stdin (or argument).
   - `R` outputs `{ message: "new text", agent: "coder", env: { ... } }` via stdout.
   - System merges output back into state.
4. Final state is passed to `handleUserMessage` in `src/daemon/message.ts`.

## Possible Output Properties for a Router
- `message` (string): Replace or modify the message text.
- `agent` (string): Re-route the message to a different agent ID.
- `session` (string): Specify a specific session ID to use (like `/new`).
- `env` (Record<string, string>): Inject environment variables to pass to the agent process.
- `cwd` (string): Override the execution directory for the agent.
- `abort` (boolean): If true, stop processing the message entirely (don't invoke any agent, just log it or drop it).
- `reply` (string): Immediately log a response to the user and (optionally) `abort`. Useful for simple query commands without invoking an LLM.

## Implementation details to discover
- How should built-in routers be differentiated from user-defined ones? User-defined could be shell scripts or executables, while `@clawmini/...` are handled natively in TypeScript.
- Should user-defined routers receive input via `stdin` or environment variable? stdin seems best for JSON.
- Is there a timeout for routers?
- Should the `routers` array allow arguments? Like `["@clawmini/slash-command", "./my-router.sh"]`.
