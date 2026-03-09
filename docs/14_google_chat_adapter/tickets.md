# Google Chat Adapter Tickets

## Ticket 1: Scaffolding, Dependencies, and Configuration
**Description**: Set up the project structure for the new Google Chat adapter, add required dependencies, and implement the configuration parsing logic.
**Steps**:
1. Add `@google-cloud/pubsub` and `googleapis` to `package.json` dependencies.
2. Create `src/adapter-google-chat/` directory.
3. Create `src/adapter-google-chat/config.ts` using Zod to parse configuration (needs `pubsubSubscriptionName`, `defaultChatId`, `authorizedUsers`).
4. Create `src/adapter-google-chat/config.test.ts` to test the configuration parser.
**Verification**:
- Run `npm install`.
- Run `npm run test -- src/adapter-google-chat/config.test.ts`.
- Run checks from `CHECKS.md`: `npm run format:check && npm run lint && npm run check && npm run test`.
**Status**: completed

## Ticket 2: State Management
**Description**: Implement state tracking to avoid processing or dispatching duplicate messages across restarts.
**Steps**:
1. Create `src/adapter-google-chat/state.ts` mimicking the Discord adapter's state tracking (e.g., tracking `lastSyncedMessageId`).
2. Create `src/adapter-google-chat/state.test.ts`.
**Verification**:
- Run `npm run test -- src/adapter-google-chat/state.test.ts`.
- Run checks from `CHECKS.md`: `npm run format:check && npm run lint && npm run check && npm run test`.
**Status**: completed

## Ticket 3: Utilities and File Attachments
**Description**: Implement utility functions for handling Google Chat API authentication using Application Default Credentials (ADC) and downloading attachments.
**Steps**:
1. Create `src/adapter-google-chat/utils.ts` for downloading file attachments securely.
2. Ensure file size limits (e.g., 25MB) are enforced if applicable.
3. Create `src/adapter-google-chat/utils.test.ts` for testing attachment utilities.
**Verification**:
- Run `npm run test -- src/adapter-google-chat/utils.test.ts`.
- Run checks from `CHECKS.md`: `npm run format:check && npm run lint && npm run check && npm run test`.
**Status**: completed

## Ticket 4: Message Ingestion (Pub/Sub Client)
**Description**: Implement the Pub/Sub listener that receives incoming Google Chat events, validates authorized users, and forwards valid messages to the Clawmini daemon.
**Steps**:
1. Create `src/adapter-google-chat/client.ts`.
2. Implement Pub/Sub subscription listening.
3. Translate Google Chat message payload to Clawmini message format.
4. Implement tRPC connection to `trpc.sendMessage.mutate` for dispatching to the daemon.
5. Create `src/adapter-google-chat/client.test.ts`.
**Verification**:
- Run `npm run test -- src/adapter-google-chat/client.test.ts`.
- Run checks from `CHECKS.md`: `npm run format:check && npm run lint && npm run check && npm run test`.
**Status**: completed

## Ticket 5: Message Reply (Forwarding)
**Description**: Implement the forwarder that subscribes to messages from the daemon and replies to the corresponding Google Chat space using the Google Chat API.
**Steps**:
1. Create `src/adapter-google-chat/forwarder.ts`.
2. Connect to `trpc.waitForMessages.subscribe` to receive outgoing messages.
3. Use `spaces.messages.create` via `googleapis` to send the response back to the appropriate space/thread.
4. Create `src/adapter-google-chat/forwarder.test.ts`.
**Verification**:
- Run `npm run test -- src/adapter-google-chat/forwarder.test.ts`.
- Run checks from `CHECKS.md`: `npm run format:check && npm run lint && npm run check && npm run test`.
**Status**: not started

## Ticket 6: Main Entry Point
**Description**: Create the main executable entry point that ties together configuration parsing, state management, the Pub/Sub client, and the forwarder.
**Steps**:
1. Create `src/adapter-google-chat/index.ts`.
2. Initialize configuration, state, client, and forwarder.
3. Handle graceful shutdown (SIGINT/SIGTERM).
4. Create `src/adapter-google-chat/index.test.ts` for integration-like tests.
**Verification**:
- Run `npm run test -- src/adapter-google-chat/index.test.ts`.
- Run checks from `CHECKS.md`: `npm run format:check && npm run lint && npm run check && npm run test`.
**Status**: not started

## Ticket 7: Remove unused state management (YAGNI)
**Priority**: High
**Description**: Delete `state.ts` and `state.test.ts`. Pub/Sub manages cursors via message ACKs, so manual state tracking of `lastSyncedMessageId` is unnecessary.
**Status**: completed

## Ticket 8: Cache Google Auth client in utils (Performance/DRY)
**Priority**: Medium
**Description**: Refactor `downloadAttachment` in `utils.ts` to cache the Google Auth client so it's not recreated on every download.
**Status**: completed

## Ticket 9: Use crypto.randomUUID for attachment filenames (Collision Risk)
**Priority**: Low
**Description**: Update `client.ts` to use `crypto.randomUUID()` instead of `Date.now()` for downloaded attachment filenames to prevent collision if multiple attachments arrive in the same millisecond.
**Status**: completed

## Ticket 10: Use configured maxAttachmentSizeMB when downloading attachments
**Priority**: High
**Description**: The `downloadAttachment` function hardcodes a 25MB limit. It should accept the `maxAttachmentSizeMB` property from the Google Chat configuration and enforce it.
**Status**: completed

## Ticket 11: Cleanup fs module imports in config tests
**Priority**: Low
**Description**: Fix the inconsistent mocking and dynamic imports of the `node:fs` module in `config.test.ts` to improve test readability.
**Status**: completed

## Ticket 12: Add noWait flag when forwarding messages
**Priority**: High
**Description**: When the client forwards an incoming message to the daemon, it should pass the `noWait: true` flag in the `sendMessage` mutation payload to prevent blocking on message generation.
**Status**: completed

