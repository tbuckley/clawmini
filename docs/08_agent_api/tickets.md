# Agent API Tickets

## Step 1: Configuration Updates
**Description:** Update the global settings schema to support the new `api` configuration option.
**Tasks:**
- Modify `src/shared/config.ts` (or relevant config file) to add an `api` property to the `SettingsSchema`.
- The `api` property should accept:
  - `false` (default): Web server does not start.
  - `true`: Web server starts on `127.0.0.1:3000` (or similar default).
  - An object `{ host: string, port: number }`: Web server starts on the specified host and port.
- Add/update tests for config parsing to ensure the new `api` property is handled correctly.
**Verification:**
- Run `npm run format:check && npm run lint && npm run check && npm run test`
**Status:** Completed

## Step 2: Daemon HTTP Server
**Description:** Optionally start an HTTP server in the daemon to expose the tRPC router based on configuration.
**Tasks:**
- Modify `src/daemon/index.ts` to check the `api` configuration.
- If enabled, start an HTTP server (e.g., using `@trpc/server/adapters/node-http` or similar depending on the existing setup).
- Bind the tRPC router to this HTTP server.
- Ensure the server gracefully shuts down when the daemon stops.
**Verification:**
- Add unit/e2e tests to verify the HTTP server starts with the correct config and responds to tRPC requests.
- Run `npm run format:check && npm run lint && npm run check && npm run test`
**Status:** Completed

## Step 3: Agent Execution Context & Token Security
**Description:** Inject context and secure tokens into agent processes and validate them on the HTTP server.
**Tasks:**
- Implement a secure token generation and validation mechanism (e.g., HMAC with a secret or a simple JWT). The token must encode `chatId`, `agentId`, `sessionId`, and a `timestamp`.
- Update the daemon's tRPC context/middleware to validate `CLAW_API_TOKEN` (e.g., from the `Authorization` header) for HTTP requests, ensuring requests are scoped to the authorized chat/agent.
- Modify the agent spawning logic (likely in `src/daemon/message.ts` or related) to generate this token.
- Inject `CLAW_API_URL` and `CLAW_API_TOKEN` into the environment variables (`env`) of the spawned agent process.
**Verification:**
- Add unit tests for token generation and validation.
- Add integration tests verifying that spawned agents receive the correct environment variables.
- Run `npm run format:check && npm run lint && npm run check && npm run test`
**Status:** Completed

## Step 4: `clawmini export-lite` Command
**Description:** Add a new CLI command to export the standalone `clawmini-lite` client script.
**Tasks:**
- Create the source for `clawmini-lite` as a standalone, zero-dependency Node.js script (using native `fetch`).
- Add a new command `export-lite` to the CLI (`src/cli/commands/export-lite.ts` or similar).
- The command should output the script to the current directory by default, or to a specified path, or to stdout if `--stdout` is passed.
**Verification:**
- Add CLI tests to verify `clawmini export-lite` correctly writes the script file or outputs to stdout.
- Run `npm run format:check && npm run lint && npm run check && npm run test`
**Status:** Not started

## Step 5: `clawmini-lite` Client Functionality
**Description:** Implement the functionality within the exported `clawmini-lite` script.
**Tasks:**
- Ensure the `clawmini-lite` script reads `CLAW_API_URL` and `CLAW_API_TOKEN` from `process.env`.
- Implement a lightweight tRPC client (using `fetch`) inside the script.
- Implement the supported subcommands:
  - `log <message>`: Appends a `{type: "log"}` message to the chat.
  - `jobs list`: Lists cron jobs for the chat.
  - `jobs add <...>`: Adds a job for the chat.
  - `jobs delete <id>`: Deletes a job from the chat.
**Verification:**
- Add e2e tests that execute the exported `clawmini-lite` script as a subprocess against a running daemon HTTP server to verify all subcommands work correctly.
- Run `npm run format:check && npm run lint && npm run check && npm run test`
**Status:** Not started