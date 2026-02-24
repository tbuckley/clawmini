# Development Log

## Step 1: Core Chat Data Types & Storage Utilities

- Implemented `src/shared/chats.ts` with `UserMessage`, `CommandLogMessage`, and file utilities.
- Implemented unit tests in `src/shared/chats.test.ts`.

## Step 2: Daemon Concurrency & Execution Logic

- Added `handleUserMessage` in `src/daemon/queue.ts` which uses a queue-per-directory concurrency control.
- Updated `sendMessage` in `src/daemon/router.ts` to call `handleUserMessage` with the default chat if none is provided.
- Added test coverage in `src/daemon/queue.test.ts` for directory-based execution sequences and failure logging without halting.

## Step 3: CLI Chat Management Commands

- Created `src/cli/commands/chats.ts` with `list`, `add`, `delete`, and `set-default` commands using commander.
- Registered the new `chatsCmd` in `src/cli/index.ts`.
- Implemented comprehensive E2E tests in `src/cli/e2e.test.ts` for chat creation, listing, setting default, and deletion in a sandbox environment.
- Fixed a typescript `any` issue in `src/shared/chats.ts`.
- Validated logic by running all types, lints, and vitest passes successfully.

## Step 4: CLI Messaging and History Commands

- Updated `messages send` command in `src/cli/commands/messages.ts` to support routing via `--chat <id>`.
- Implemented `messages tail` command to view history of a given chat id, with support for human-readable output and `--json` raw JSONL output.
- Fixed TypeScript warnings (unexpected any) in `src/daemon/queue.ts` and `src/daemon/queue.test.ts`.
- Wrote full E2E test coverage in `src/cli/e2e.test.ts` for sending to specific chats and verifying historical output via tail.

## Step 5: Background Messaging

- Updated `src/daemon/queue.ts` to accept a `noWait` argument, so the daemon immediately returns without awaiting task completion when set.
- Updated the TRPC mutation in `src/daemon/router.ts` to accept a boolean `noWait` flag and forward it.
- Updated `src/cli/commands/messages.ts` with a `--no-wait` flag using `commander`.
- Verified behavior with an added E2E test in `src/cli/e2e.test.ts` that runs commands effectively without halting the client process.
