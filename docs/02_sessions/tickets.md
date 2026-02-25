# Tickets: Sessions Feature

## Ticket 1: Update Configuration Schema & Types
**Description**: Update the agent configuration types and Zod schemas in `src/shared/config.ts` to support the new commands structure (`new`, `append`, `getSessionId`, `getMessageContent`). Ensure usage of Zod 4 best practices (e.g., `z.record(z.string(), z.string())` for records).
**Verification**: 
- `npm run check`
- `npm run test`
**Status**: complete

## Ticket 2: CLI Flag for Sessions
**Description**: Update the CLI `messages send` command in `src/cli/commands/messages.ts` to accept an optional `-s, --session <id>` flag. Pass the session ID to the TRPC `send-message` payload.
**Verification**: 
- Add E2E tests verifying flag parsing and payload structure.
- `npm run test`
- `npm run check`
- `npm run lint`
**Status**: complete

## Ticket 3: State Storage Utilities
**Description**: Implement read/write utilities in `src/shared/workspace.ts` to manage Chat State (`.clawmini/chats/<chatId>/settings.json`) and Agent Session State (`.clawmini/agents/<agentId>/sessions/<sessionId>/settings.json`). 
**Verification**: 
- Write unit tests for the new storage utility functions.
- `npm run test`
- `npm run check`
**Status**: complete

## Ticket 4: Daemon Session Resolution & Execution
**Description**: Update `handleUserMessage` in `src/daemon/message.ts` to resolve the `sessionId` (CLI `--session` -> chat settings -> `'default'`). Check if the agent session state file exists. If it exists, execute `commands.append` (injecting `SESSION_ID` into the `env`). If not, execute `commands.new`.
**Verification**: 
- Add unit tests mocking `node:child_process.spawn` to verify correct commands and environment variables are used.
- `npm run test`
- `npm run check`
**Status**: complete

## Ticket 5: Command Extraction & State Updates
**Description**: Implement the extraction logic in the daemon after the primary command finishes. Spawn `getSessionId` (if it was a new session) and `getMessageContent` (if defined), piping the main command's stdout to their stdin. Parse the outputs and update the Chat and Agent Session settings files.
**Verification**: 
- Add unit tests verifying stdin piping and correct state file updates upon success.
- `npm run test`
- `npm run check`
**Status**: complete

## Ticket 6: Logging & Final Integration
**Description**: Update the `CommandLogMessage` structure in the chat log (`chat.jsonl`) to include both raw stdout and extracted message text. Gracefully handle extraction command failures by logging them as `stderr` in `chat.jsonl`. Complete the feature by writing an E2E test covering the full multi-message session workflow.
**Verification**: 
- Full suite of E2E tests in an isolated sandbox testing the daemon and CLI workflows.
- `npm run build`
- `npm run check`
- `npm run lint`
- `npm run test`
**Status**: complete

## Ticket 7: DRY Violation in `src/shared/workspace.ts`
**Priority**: High
**Description**: The read/write functions for `ChatSettings` and `AgentSessionSettings` contain duplicate file reading, JSON parsing, and directory creation logic. They also unnecessarily use synchronous `fs.existsSync` inside an async function.
**Verification**:
- Extract a generic `readJsonFile` and `writeJsonFile` utility.
- Use `fsPromises.mkdir` natively (with `recursive: true` and swallowing `EEXIST` implicitly) instead of sync directory checking.
- `npm run format`, `npm run lint`, `npm run check`, `npm run test`.
**Status**: complete

## Ticket 8: DRY Violation in `src/daemon/message.ts`
**Priority**: Medium
**Description**: `extractSessionId` and `extractMessageContent` contain nearly identical execution and error handling logic for running extraction commands.
**Verification**:
- Extract a generic `runExtractionCommand` utility.
- `npm run format`, `npm run lint`, `npm run check`, `npm run test`.
**Status**: complete
