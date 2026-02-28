# Product Requirements Document: Routers

## Vision
The Routers feature aims to provide an extensible, middleware-like pipeline for processing user messages before they reach an agent. By allowing users to define a sequence of routers, they can dynamically alter message content, target specific agents or sessions, inject environment variables, and add automated replies. This gives users powerful, scriptable control over the routing logic of their chat sessions.

## Product/Market Background
Currently, Clawmini routes a user's message directly to an agent based on static chat settings. While effective, it lacks the flexibility to adapt to dynamic conditions—such as creating a new session from a slash command (e.g., `/new`), expanding macros or file contents (e.g., `/command`), or redirecting messages based on content analysis (e.g., sending simple questions to a fast model and complex ones to a reasoning model). Routers solve this by introducing an interception layer.

## Use Cases
1. **Starting Fresh (`/new`)**: A user types `/new` at the beginning of a message. A router intercepts this, generates a new session UUID, and redirects the message to this new session, effectively clearing the context window for the agent.
2. **Text Expansion (`/command`)**: A user types `/foo` in their message. A router intercepts this, reads the contents of `.clawmini/commands/foo.md`, and replaces `/foo` with the file's content before passing it to the agent.
3. **Dynamic Agent Routing**: A user writes a custom shell script router that analyzes the message length. If the message is short, it sets `agent: "fast-model"`. If long, it sets `agent: "reasoning-model"`.
4. **Environment Injection**: A custom router looks up a specific context (e.g., the current git branch) and injects it as an environment variable (`env: { GIT_BRANCH: "main" }`) for the agent to use.
5. **Immediate Replies**: A router detects a simple query (e.g., `/ping`) and immediately responds with `reply: "pong"` without ever invoking the heavier agent process.

## Requirements

### Configuration
1. **Settings Definition**: Routers are defined as an array of strings under the `routers` key in `.clawmini/settings.json` (global) or `.clawmini/chats/ID/settings.json` (per-chat).
2. **Opt-in Nature**: Built-in routers are not enabled by default. Users must explicitly add them to the `routers` array.
3. **Execution Order**: Routers defined in the array execute sequentially, in the order they are listed.

### Router Execution
1. **Built-in Routers**: Strings prefixed with `@clawmini/` map to internal TypeScript functions.
   - `@clawmini/slash-new`: Checks if the message starts with `/new`. If so, creates a new session ID (random UUID), sets the session property, and removes `/new` from the message.
   - `@clawmini/slash-command`: Checks if the message contains a slash command (e.g., `/foo` or `/foo:bar`). It looks for a matching file in `.clawmini/commands/` (`.clawmini/commands/foo.md` or `.clawmini/commands/foo/bar.md`). If found, it replaces the slash command with the file's contents.
2. **Custom Shell Routers**: Strings not prefixed with `@clawmini/` are treated as shell commands executed in the workspace root.
3. **Input Mechanism**: The system serializes the current state (e.g., `{ "message": "...", "chatId": "...", "agentId": "...", "sessionId": "...", "env": {} }`) to JSON and passes it to the shell command via `stdin`.
4. **Output Processing**: The system reads the stdout of the shell command, expecting a JSON object.

### Router Capabilities (Output Properties)
Routers can return a JSON object with any of the following properties to modify the state for the next router or the final agent execution:
- `message` (string): Replaces the original user message text.
- `agent` (string): Overrides the target agent ID for this message.
- `session` (string): Specifies a specific session ID to use.
- `env` (Record<string, string>): Injects or overrides environment variables for the agent process.
- `reply` (string): A text response to be injected into the chat timeline immediately before the agent's response.

### Chat Timeline Integration
1. **Reply Injection**: If a router returns a `reply` string, a new `ChatMessage` must be appended to the chat log *before* the agent is invoked.
2. **Reply Format**: This injected message must have `role: 'log'` and a new property `source: 'router'`.

### Error Handling
1. **Silent Failure**: If a custom shell router exits with a non-zero code, fails to output valid JSON, or times out, the system should log an error for debugging purposes (e.g., console log or internal debug log) but must *not* halt processing. It should continue passing the current (unmodified by the failing router) state to the next router or agent.

## Privacy, Security & Accessibility Concerns
- **Security (Shell Execution)**: Custom routers are executed as shell commands. This carries inherent risks if malicious commands are placed in the `settings.json`. However, this is consistent with Clawmini's existing trust model where users control their local `.clawmini` configuration and workspace scripts.
- **Security (Path Traversal)**: The `@clawmini/slash-command` router must ensure it does not allow path traversal (e.g., `/../../../etc/passwd`) when looking up command files. It must rigidly confine lookups to the `.clawmini/commands/` directory.

## Implementation Plan
1. Update schema definitions in `src/shared/config.ts` to support the `routers` array.
2. Update `ChatMessage` schema in `src/shared/chats.ts` to support the optional `source: 'router'` property for log messages.
3. Create a new `src/daemon/routers.ts` file to handle the pipeline execution (parsing settings, running built-in vs shell routers, managing state transitions).
4. Implement the `@clawmini/slash-new` and `@clawmini/slash-command` internal functions.
5. Integrate the pipeline into `handleUserMessage` in `src/daemon/message.ts` before the queue execution.
