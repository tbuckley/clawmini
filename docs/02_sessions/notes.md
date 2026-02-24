# Notes for Sessions Feature

## Current Implementation
- **CLI Command**: `clawmini messages send "hi" [-c <chatId>]` sends a `send-message` mutation to the daemon.
- **Daemon Handling**: `router.ts` reads the global `.clawmini/settings.json` to get agent config (`defaultAgent.commands.new`). It passes this to `handleUserMessage` in `message.ts`.
- **Message Execution**: `handleUserMessage` sets the `CLAW_CLI_MESSAGE` environment variable and runs the command.
- **Output Logging**: `router.ts` spawns the command, captures `stdout` and `stderr`, and saves a `CommandLogMessage` via `appendMessage`.
- **Storage**: Chats are stored in `.clawmini/chats/<chatId>/chat.jsonl`.

## Proposed Architecture
- **Agent Configuration Update**: Agents need new commands in `.clawmini/settings.json`:
  - `new`: Starts a new session.
  - `append`: Appends to a session.
  - `getSessionId`: A shell command that takes the stdout of `new` via stdin and prints the session ID.
  - `getMessageContent`: A shell command that takes the stdout of `new` or `append` via stdin and prints the message content.
- **Chat State**: Each chat gets a `settings.json` at `.clawmini/chats/<chatId>/settings.json`:
  ```json
  {
    "defaultAgent": "default",
    "sessions": {
      "default": "<sessionId>" // The ID from --session or 'default'
    }
  }
  ```
- **Agent Session State**: Each agent session gets a `settings.json` at `.clawmini/agents/<agentId>/sessions/<sessionId>/settings.json`:
  ```json
  {
    "env": {
      "SESSION_ID": "<agent's internal session id>"
    }
  }
  ```
- **Execution Flow (`messages send`)**:
  1. Determine `sessionId`: use `--session` if provided. Otherwise, read `.clawmini/chats/<chatId>/settings.json` to get `defaultAgent` and its associated `<sessionId>`. If still not found, use `'default'`.
  2. Check if `.clawmini/agents/<agentId>/sessions/<sessionId>/settings.json` exists.
  3. If it exists, execute `append` command (passing the internal `SESSION_ID` in `env` from the session's `settings.json`).
  4. If session doesn't exist, execute `new`.
  5. After `new`, run `getSessionId` passing `new`'s stdout via stdin. Save the extracted internal session ID to `.clawmini/agents/<agentId>/sessions/<sessionId>/settings.json`. Update chat's `settings.json` with the new `<sessionId>`.
  6. After either `new` or `append`, run `getMessageContent` passing the stdout via stdin. Extract the message text.
  7. Write output logs (`CommandLogMessage`) to `.clawmini/chats/<chatId>/chat.jsonl`, including both the raw stdout and the extracted message text (if any).
