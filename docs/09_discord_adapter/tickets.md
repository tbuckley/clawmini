# Tickets: Discord Adapter for Clawmini

## Step 1: Scaffold Discord Adapter
- **Description:** 
  - Create the `src/adapter-discord` directory.
  - Create a basic entry point in `src/adapter-discord/index.ts` that logs a startup message.
  - Update `tsdown.config.ts` to include the new entry point.
  - Add `discord.js` to `package.json` dependencies.
- **Verification:**
  - `npm run check` passes.
  - `npm run build` generates `dist/adapter-discord/index.mjs`.
  - Running `node dist/adapter-discord/index.mjs` prints the startup message.
- **Status:** completed

## Step 2: Configuration & Security Implementation
- **Description:** 
  - Define the configuration schema using Zod in `src/adapter-discord/config.ts`.
  - Implement logic to load configuration from `.clawmini/adapters/discord/config.json`.
  - Implement an `isAuthorized(userId: string)` helper to filter Discord messages.
- **Verification:**
  - Unit tests in `src/adapter-discord/config.test.ts` for schema validation and file loading.
  - Unit tests for the authorization filter.
  - `npm run format:check && npm run lint && npm run check && npm run test` passes.
- **Status:** completed

## Step 3: TRPC Client Connection
- **Description:** 
  - Implement a TRPC client in `src/adapter-discord/client.ts` that connects to the daemon via the Unix socket, leveraging the shared logic in `src/shared/fetch.ts` if possible.
- **Verification:**
  - Integration test mocking the Unix socket and verifying TRPC calls from the adapter client.
  - `npm run check && npm run test` passes.
- **Status:** completed

## Step 4: Discord to Daemon Forwarding
- **Description:** 
  - Initialize the `discord.js` client in `src/adapter-discord/index.ts`.
  - Listen for `messageCreate` events in DM channels.
  - Validate the sender using the authorized user ID.
  - Forward the message content to the daemon using the `sendMessage` TRPC endpoint.
- **Verification:**
  - Mocked `discord.js` event test verifying that receiving a DM triggers a TRPC `sendMessage` call.
  - `npm run format:check && npm run lint && npm run check && npm run test` passes.
- **Status:** completed

## Step 5: Daemon Message Observation Enhancement
- **Description:** 
  - Update `src/daemon/router.ts` and related files to support message observation. 
  - Since TRPC 11 is used, consider adding an SSE or long-polling endpoint if full subscriptions aren't trivial in the current Unix socket setup, or just a `getMessagesAfter(timestamp)` endpoint.
  - *Note:* The PRD suggests "message subscription/observation mechanism".
- **Verification:**
  - Unit/Integration tests for the new observation endpoint.
  - Verify that sending a message via TRPC results in the observer being notified.
  - `npm run check && npm run test` passes.
- **Status:** not started

## Step 6: Daemon to Discord Forwarding
- **Description:** 
  - In the adapter, use the new observation mechanism to listen for new messages from the daemon.
  - When a new message is received, send it to the authorized user's Discord DM channel using the bot client.
- **Verification:**
  - Integration test verifying that a message appearing in the daemon's observation stream is forwarded to the Discord mock client.
  - `npm run check && npm run test` passes.
- **Status:** not started

## Step 7: State Management & Startup Sync
- **Description:** 
  - Implement `src/adapter-discord/state.ts` to manage `.clawmini/adapters/discord/state.json`.
  - Track the `lastSyncedMessageId` or timestamp.
  - On adapter startup, fetch all messages from the daemon after the stored cursor and send them to Discord.
- **Verification:**
  - Unit tests for state persistence.
  - Integration test for the startup sync logic.
  - `npm run check && npm run test` passes.
- **Status:** not started

## Step 8: Debouncing & Robustness
- **Description:** 
  - Add debouncing logic to handle rapid Discord messages (if necessary for the daemon's message queue).
  - Improve error handling (e.g., bot reconnect logic, daemon connection retry).
- **Verification:**
  - Unit tests for debouncing.
  - `npm run format:check && npm run lint && npm run check && npm run test` passes.
- **Status:** not started

## Step 9: Documentation
- **Description:** 
  - Create `./docs/guides/discord_adapter_setup.md` with full setup instructions.
- **Verification:**
  - File exists and contains clear steps for Bot creation, Token retrieval, and Configuration.
- **Status:** not started
