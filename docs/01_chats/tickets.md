# Implementation Tickets: Chats Feature

## Step 1: Core Chat Data Types & Storage Utilities
**Description**: Define the core data structures for chats and messages, and implement the file-system utilities to read/write chat history in JSONL format.
**Tasks**:
- Define TypeScript interfaces for `UserMessage` and `CommandLogMessage` based on the PRD schema.
- Implement storage utilities (e.g., in `src/shared/chats.ts`) for managing `.clawmini/chats/<id>/chat.jsonl`.
- Functions needed: `createChat(id)`, `listChats()`, `deleteChat(id)`, `appendMessage(id, message)`, `getMessages(id, limit)`.
- Implement global default chat tracking (e.g., in `settings.json` or a separate state file).
**Verification**:
- Write unit tests verifying JSONL reading/writing (appending correctly, parsing correctly).
- Write unit tests for directory creation and deletion for chats.
- Run type-checking (`tsc`) and linter.
**Status**: complete

## Step 2: Daemon Concurrency & Execution Logic
**Description**: Update the background daemon to handle messages targeted at specific chats and introduce directory-based concurrency control.
**Tasks**:
- Implement `handleUserMessage(chatId, message, settings)` in the daemon.
- Create a directory-based queue mechanism. Ensure commands targeting the same `cwd` run sequentially, while commands for different directories can run concurrently.
- Capture command stdout, stderr, and exit code, and append them as a `log` message to the corresponding chat's `chat.jsonl`.
- Do not halt the queue on non-zero exit codes.
**Verification**:
- Write unit tests for the execution queue, mocking command execution to verify sequential vs concurrent execution based on `cwd`.
- Verify failure logs (exitCode, stderr) are written correctly even if a command fails.
- Run type-checking (`tsc`) and linter.
**Status**: complete

## Step 3: CLI Chat Management Commands
**Description**: Implement the `clawmini chats` CLI commands for users to manage their chat sessions.
**Tasks**:
- Implement `clawmini chats list` to display existing chats.
- Implement `clawmini chats add <id>` to initialize a new chat.
- Implement `clawmini chats delete <id>` to remove a chat.
- Implement `clawmini chats set-default <id>` to update the workspace's default chat.
**Verification**:
- Write E2E tests using `node:child_process.spawn` pointing to `dist/cli/index.mjs`.
- Run commands in an isolated sandbox temporary directory (`cwd: e2eDir`).
- Verify the CLI output and the creation/deletion of `.clawmini/chats/<id>` directories.
- Explicitly tear down E2E tests (e.g., `pkill -f "dist/daemon/index.mjs"`) in the `afterAll` hook.
- Run type-checking (`tsc`) and linter.
**Status**: complete

## Step 4: CLI Messaging and History Commands
**Description**: Update the existing `send` command to support chats and implement the `tail` command for viewing history.
**Tasks**:
- Update `clawmini messages send <message> [--chat <id>]` to route the message to the specified chat (or the default one).
- Implement `clawmini messages tail [-n NUM] [--json] [--chat <id>]`.
- Format `tail` output for human readability by default, and output raw JSONL if `--json` is passed.
**Verification**:
- Write E2E tests sending messages to a specific chat and verifying they are properly stored.
- Write E2E tests for `tail` command, verifying both formatted text output and `--json` raw output.
- Write E2E tests verifying the `--chat` flag correctly overrides the default chat.
- Run tests in an isolated sandbox directory, with proper daemon teardown in `afterAll`.
- Run type-checking (`tsc`) and linter.
**Status**: complete

## Step 5: Background Messaging
**Description**: Support returning immediately from `messages send` using a `--no-wait` flag. By default, it should wait for the response to finish. The server should queue the message and send it when ready.
**Tasks**:
- Update `messages send` to accept `--no-wait`.
- Update `sendMessage` trpc mutation to accept an optional `noWait` boolean.
- Update `handleUserMessage` in `src/daemon/queue.ts` to skip awaiting the task execution if `noWait` is true.
**Verification**:
- Verify tests.
- Add E2E test case for `--no-wait` flag.
**Status**: complete