# Product Requirements Document: Chat Sessions

## 1. Vision & Goals

Currently, sending a message to the agent always spawns a fresh process with no memory of the prior context unless the agent itself happens to maintain it invisibly. The "Sessions" feature introduces the capability for `clawmini` to persistently identify and track agent sessions, allowing users to send subsequent messages that extend an existing conversation.

The primary goals of this feature are:
- Introduce persistent session states for agent conversations.
- Differentiate between starting a new session and appending to an existing one.
- Enable `clawmini` to extract internal agent session IDs and message content from arbitrary outputs via shell commands.
- Track mapping between `clawmini` chats and agent sessions locally.

## 2. Product / Market Background

AI agents (like LLMs or specialized CLI agents) often require state to maintain context across multiple turns of a conversation. By giving `clawmini` the ability to store a session identifier locally and pass it back to the agent in subsequent commands, we enable stateful conversational loops. This maps well to how users expect standard chat applications or LLM tools to operate.

## 3. Use Cases

1. **Continuing a Conversation**: A user runs `clawmini messages send "Hello"` and a new agent session is started. They then run `clawmini messages send "What did I just say?"` and the CLI sends the message to the same session, allowing the agent to reply accurately based on the history.
2. **Multiple Agent States in One Chat**: A user can use `--session foo` to interact with session `foo`, then switch to `--session bar` within the same chat workspace.
3. **Structured Agent Responses**: Agents returning complex structures (JSON, YAML, custom text) can have their exact message and session IDs extracted via standard shell pipelines (e.g., using `jq` or `grep`), without enforcing a rigid output format on the agent.

## 4. Requirements

### 4.1 CLI Interface Updates
- Update the `messages send <message>` command to support an optional `--session <id>` flag.
- **Session Resolution Logic:**
  - If `--session` is provided, use that session ID.
  - If not provided, read the chat's `settings.json` (at `.clawmini/chats/<chatId>/settings.json`) to find the active session for the `defaultAgent`.
  - If no session is found in the chat settings, default to the ID `'default'`.

### 4.2 Agent Configuration Updates
Agents defined in `.clawmini/settings.json` will require updated fields:
- `commands.new`: The command used to initialize a new session.
- `commands.append`: The command used to append a message to an existing session.
- `commands.getSessionId`: A shell command that takes the stdout of `new` via `stdin` and outputs the internal session ID.
- `commands.getMessageContent`: A shell command that takes the stdout of `new` or `append` via `stdin` and outputs the text content to show to the user.

### 4.3 Data Storage & State Management
- **Chat State**: Maintained at `.clawmini/chats/<chatId>/settings.json`.
  ```json
  {
    "defaultAgent": "default",
    "sessions": {
      "default": "<sessionId>"
    }
  }
  ```
- **Agent Session State**: Maintained at `.clawmini/agents/<agentId>/sessions/<sessionId>/settings.json`.
  ```json
  {
    "env": {
      "SESSION_ID": "<agent's internal session id>"
    }
  }
  ```

### 4.4 Execution Flow (Daemon)
When a `send-message` request is processed by the daemon:
1. Identify the target `chatId` and `sessionId` (based on the CLI request and chat settings).
2. Determine if the agent session exists by checking for `.clawmini/agents/<defaultAgent>/sessions/<sessionId>/settings.json`.
3. **If the session exists:**
   - Construct the environment, injecting the agent's internal `SESSION_ID` from the session settings.
   - Execute the `commands.append` command.
4. **If the session does not exist:**
   - Execute the `commands.new` command.
5. **Post-Execution Extraction:**
   - If a new session was started and `commands.getSessionId` is defined, spawn the `getSessionId` command, writing the `new` command's stdout to its `stdin`. Read the resulting output as the internal session ID. Save this to the agent session settings file, and update the chat settings file.
   - If `commands.getMessageContent` is defined, spawn it, writing the `new`/`append` command's stdout to its `stdin`. Read the resulting output as the extracted message text.
   - Persist the execution details in the chat log (`chat.jsonl`), including both the raw stdout and the extracted message text (if applicable).

## 5. Non-Functional Concerns
- **Dependencies**: No external JSON parsers (like `jsonpath-plus`) are required. The host system's shell environment (and tools like `jq` or `awk`) will be used via the agent's configured extraction commands.
- **Error Handling**: Gracefully handle failures in the `getSessionId` or `getMessageContent` commands (e.g., command not found, pipeline failures). Log these errors to `chat.jsonl` as `stderr` so the user is informed of the extraction failure. Provide fallbacks where appropriate (e.g., using raw stdout if text extraction fails).
- **Security**: The `SESSION_ID` read from `settings.json` and injected into the environment must not allow command injection; relying on `child_process.spawn` with `env` blocks is safe, provided we use it correctly without arbitrary string interpolation in the shell. Running arbitrary shell commands via `getSessionId` and `getMessageContent` follows the same security model as `new` and `append`.
