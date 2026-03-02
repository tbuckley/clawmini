# Development Log

## Step 1: Configuration Updates
- Starting work on Step 1: Updating the global settings schema to support the `api` configuration.
- Added `api` property to `SettingsSchema` in `src/shared/config.ts` supporting boolean or object with `host` and `port`.
- Created `src/shared/config.test.ts` to test `SettingsSchema` properties specifically around `api` configuration.
- Addressed minor formatting issues and fixed one incorrectly written unit test assertion.
- All code checks (`npm run format:check && npm run lint && npm run check && npm run test`) pass.
- Step 1 complete.

## Step 2: Daemon HTTP Server
- Started work on Step 2.
- Updated `src/daemon/index.ts` to read `settings.json`, check if the `api` configuration is enabled, and conditionally start an HTTP server on the configured host and port.
- Bound the same `createHTTPHandler` from `@trpc/server/adapters/standalone` to this API server to expose the tRPC router over HTTP.
- Handled graceful shutdown by closing the `apiServer` when `SIGINT` or `SIGTERM` signals are received.
- Added a new e2e test in `src/cli/e2e/daemon.test.ts` that configures `api` in `settings.json`, restarts the daemon, and checks the HTTP endpoint via a simple `/ping` request.
- Ran formatting, linting, and all tests via `npm run format:check && npm run lint && npm run check && npm run test`, ensuring all verification checks pass.
- Step 2 complete.

## Step 3: Agent Execution Context & Token Security
- Started work on Step 3.
- Implemented `src/daemon/auth.ts` to generate and validate `CLAW_API_TOKEN` using `crypto.createHmac`. 
- Updated `src/daemon/router.ts` with `Context` resolving `isApiServer` and `tokenPayload`.
- Implemented `apiAuthMiddleware` in `src/daemon/router.ts` to require and validate auth tokens for HTTP API requests.
- Updated endpoints in `src/daemon/router.ts` to use `apiProcedure` and explicitly check if the agent context matches the requested `chatId` using `checkScope()`.
- Added logic in `src/daemon/message.ts` to inject `CLAW_API_URL` and `CLAW_API_TOKEN` into the environment of the executed agent process when the API is enabled in settings.
- Added unit tests in `src/daemon/auth.test.ts`.
- Added integration tests in `src/cli/e2e/daemon.test.ts` to verify the environment injection for spawned agents.
- All code checks pass successfully.
- Step 3 complete.

## Step 4: `clawmini export-lite` Command
- Started work on Step 4.
- Implemented a new command `export-lite` in `src/cli/commands/export-lite.ts`.
- Added the basic script content for `clawmini-lite.js` checking for `CLAW_API_URL` and `CLAW_API_TOKEN`.
- Bound the command in `src/cli/index.ts`.
- Supported saving to the current directory, a specific path via `--out`, and outputting to stdout via `--stdout`.
- Created e2e CLI tests in `src/cli/e2e/export-lite.test.ts` to verify output correctly saves to file paths or stdout.
- Ran all verification steps successfully with `npm run format:check && npm run lint && npm run check && npm run test`.
- Step 4 complete.

## Step 5: `clawmini-lite` Client Functionality
- Started work on Step 5.
- Added a new `logMessage` endpoint to `src/daemon/router.ts` to allow agents to append a log message to the chat.
- Updated `logMessage`, `listCronJobs`, `addCronJob`, and `deleteCronJob` in `src/daemon/router.ts` to automatically infer the `chatId` from the agent's authentication token (`ctx.tokenPayload.chatId`) if not explicitly provided over HTTP API requests.
- Updated `liteScriptContent` in `src/cli/commands/export-lite.ts` to implement full `clawmini-lite` functionality.
- Created a robust zero-dependency script parser inside `clawmini-lite` that handles `--flags` properly.
- Implemented batched syntax for GET requests and proper body parsing for POST requests within `trpcCall`.
- Supported subcommands: `log <message>`, `jobs list`, `jobs add`, `jobs delete`.
- Created an end-to-end functionality test `src/cli/e2e/export-lite-func.test.ts` to verify `clawmini-lite` interacts seamlessly with the daemon HTTP API.
- Verified everything with formatting, linting, type checks, and tests: `npm run format:check && npm run lint && npm run check && npm run test`. All 95 tests pass.
- Step 5 complete.