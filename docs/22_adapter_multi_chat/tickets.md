# Tickets for Adapter Multi-Chat Support

## Ticket 1: Update State and Config Schemas for Multi-Chat Support
**Status**: Completed

**Description**: 
Update the state and configuration schemas for both the Discord and Google Chat adapters to prepare for multi-chat mapping and independent state tracking.

**Tasks**:
- Update adapter state schemas in `src/adapter-discord` and `src/adapter-google-chat` to replace `lastSyncedMessageId: string` with `lastSyncedMessageIds: Record<string, string>`.
- Add `channelChatMap: Record<string, string>` to the state schemas to map external context IDs (Channel ID / Space ID) to Daemon Chat IDs.
- Update the Discord adapter config schema to include an optional `requireMention: boolean` property, defaulting to `false`.
- Ensure backwards compatibility or safe migration for existing `state.json` files.

**Verification**:
- Verify schema changes by running tests that instantiate the adapters with updated and legacy configurations.
- Run `npm run validate` (which includes `npm run format`, `npm run lint:fix`, type-checking, and tests).

---

## Ticket 2: Implement First Contact Protocol and Message Pre-processing
**Status**: Completed

**Description**: 
Adjust the message ingestion pipeline for both adapters to handle incoming messages in new contexts and implement platform-specific filtering rules.

**Tasks**:
- **Discord**: Remove the `if (message.guild) return;` block to allow processing messages in server channels/threads.
- **Discord**: Implement logic to enforce the `requireMention` config flag. If true, ignore messages in guild channels unless the bot is explicitly `@mentioned` or directly replied to. DM behavior remains unaffected.
- **Both Adapters**: Implement the "First Contact" protocol. Before forwarding a message to the daemon, check if the external context ID (Discord channel ID or Google Chat space ID) exists in `channelChatMap`.
- If unmapped and the message is *not* a routing command (`/chat` or `/agent`), intercept the message, do not forward it, and reply with the instructional warning: "This channel/space is not currently mapped...".

**Verification**:
- Write unit tests for Discord message filtering (e.g., verifying `requireMention` behavior for guilds vs DMs).
- Write unit tests for the First Contact protocol interception logic.
- Run `npm run validate`.

---

## Ticket 3: Implement Routing Commands (`/chat` and `/agent`)
**Status**: Completed

**Description**: 
Allow users to dynamically map their current external context (channel/space) to a specific daemon chat or a new chat with a specific agent.

**Tasks**:
- Intercept and handle the `/chat [chat-id]` command:
  - Fetch available chats via `trpc.getChats.query()`. Reply with a formatted list if the provided ID is missing or invalid.
  - Enforce the **Strict 1:1 Mapping Constraint**: Return an error if the requested chat is already mapped to a different channel.
  - Upon success, update `channelChatMap` to point the current channel to the requested chat, save state, and reply with confirmation.
- Intercept and handle the `/agent [agent-id]` command:
  - Fetch available agents via `trpc.getAgents.query()`. Reply with a formatted list if the provided ID is missing or invalid.
  - If valid, generate a unique chat ID (`<agent-id>-<adapter-name>[-n]`).
  - Instruct the daemon to create the new chat and assign the agent.
  - Update `channelChatMap` to point to the newly created chat ID, save state, and reply with confirmation.

**Verification**:
- Write unit tests for command parsing, list formatting, and 1:1 constraint validation.
- Mock TRPC endpoints in tests to verify correct interaction with the daemon for fetching lists and creating chats.
- Run `npm run validate`.

---

## Ticket 4: Implement Dynamic Forwarding Subscriptions
**Status**: Completed

**Description**: 
Refactor the daemon-to-adapter forwarding logic to support multiple concurrent subscriptions and dynamic updates based on `channelChatMap`.

**Tasks**:
- Refactor `startDaemonToDiscordForwarder` and `startDaemonToGoogleChatForwarder` to manage a dynamic pool of `trpc.waitForMessages.subscribe` subscriptions instead of a single static one.
- The forwarders should iterate over unique `chatIds` in `channelChatMap` and establish a subscription for each.
- Implement an event or polling mechanism so that when `channelChatMap` changes (e.g., a new routing command is executed), the forwarder dynamically establishes subscriptions for newly mapped chats.
- Ensure the forwarder uses and updates `lastSyncedMessageIds[chatId]` independently for each subscription to prevent message loss on restart.

**Verification**:
- Write integration or unit tests verifying that multiple mocked subscriptions can run concurrently and route daemon messages to the correct mapped external channels.
- Verify that state updates dynamically trigger new subscriptions without requiring an adapter restart.
- Run `npm run validate`.

---

## Ticket 5: Add Google Chat Space Subscription Config & State Schemas
**Status**: Completed

**Description**: 
Update the schemas to support user-level Space Subscriptions for Workspace Events.

**Tasks**:
- Update `GoogleChatStateSchema` in `src/adapter-google-chat/state.ts` using `zod` to expand `channelChatMap` to store subscription data: `z.record(z.string(), z.object({ chatId: z.string().nullable().optional(), subscriptionId: z.string().optional(), expirationDate: z.string().optional() })).optional()`.
- Ensure migrations cleanly default `channelChatMap` to handle single-chat legacy formats if present.
- Rename legacy `driveOauthClientId`, `driveOauthClientSecret`, and `driveOauthTokens` to generic `oauthClientId`, `oauthClientSecret`, and `oauthTokens` across schemas.
- Update `src/adapter-google-chat/auth.ts` to request a combined scope array: `['https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/chat.messages.readonly']` and `access_type=offline`. Rename `getDriveAuthClient` to `getUserAuthClient`.
- Update `src/adapter-google-chat/index.ts` to invoke `getUserAuthClient()` if OAuth credentials exist, removing the dependency on `driveUploadEnabled !== false`.

**Verification**:
- Add unit tests for schema parsing and single-chat legacy migrations for `channelChatMap` subscriptions.
- Run `npm run validate`.

---

## Ticket 6: Implement Space Subscription Lifecycle (`ADDED_TO_SPACE` & `REMOVED_FROM_SPACE`)
**Status**: Completed

**Description**: 
Handle Google Chat bot events to automatically create and tear down Space Subscriptions when the bot is added to or removed from a Space.

**Tasks**:
- Update `startGoogleChatIngestion` in `src/adapter-google-chat/client.ts` to intercept `ADDED_TO_SPACE` events.
- If the space type is not `DIRECT_MESSAGE`:
  1. Generate a new Access Token using the saved user Refresh Token.
  2. Perform a `POST` request to `https://workspaceevents.googleapis.com/v1/subscriptions` to subscribe to `google.workspace.chat.message.v1.created` for the target space.
  3. Save the returned subscription info (`subscriptionId`, `expirationDate`) into `state.json` under the channel's entry in `channelChatMap`.
- Intercept `REMOVED_FROM_SPACE` events:
  1. Look up the `subscriptionId` in `channelChatMap`.
  2. Generate an Access Token and send a `DELETE` request to remove the subscription.
  3. Delete the subscription fields from the channel's entry in `channelChatMap`, and delete the entry entirely if `chatId` is not set.

**Verification**:
- Add unit tests mocking the Google Workspace Events API to ensure `ADDED_TO_SPACE` correctly creates subscriptions and writes to state.
- Add unit tests mocking `REMOVED_FROM_SPACE` deletion.
- Run `npm run validate`.

---

## Ticket 7: Dual-Pipeline Pub/Sub Worker Logic
**Status**: Completed

**Description**: 
Refactor message ingestion to correctly process native Bot Events alongside the newly configured Workspace Events coming from the same Pub/Sub topic, ensuring no duplication or loops.

**Tasks**:
- Update `startGoogleChatIngestion` in `src/adapter-google-chat/client.ts`.
- Read the `ce-type` attribute of the Pub/Sub message. If it equals `google.workspace.chat.message.v1.created`, parse the payload as a Workspace Event. Otherwise, parse as a native Bot Event.
- Explicitly check the sender of the event. If the sender is `BOT`, `message.ack()` and drop it immediately to prevent infinite reply loops.
- Implement an in-memory 60-second LRU cache (or Map with cleanup) to store `Message ID`s. If a message ID has already been seen (because an `@mention` triggers both pipelines), drop the duplicate.
- Ensure all outbound replies continue to use the Bot's Service Account, not the user token.

**Verification**:
- Add tests mocking Workspace Event payloads vs Bot Event payloads, verifying both are formatted and forwarded properly.
- Add tests simulating an identical Message ID arriving twice in quick succession and verify only one daemon interaction occurs.
- Add tests verifying messages from `BOT` are dropped.
- Run `npm run validate`.

---

## Ticket 8: Background Renewal Cron for Subscriptions
**Status**: Completed

**Description**: 
Implement a background process to prevent active Space Subscriptions from expiring after their default 7-day TTL.

**Tasks**:
- Implement a recurring background task (e.g., an hourly `setInterval` or cron script) in the Google Chat adapter.
- Parse `channelChatMap` from `state.json`.
- Identify subscriptions where `expirationDate` is less than 48 hours away.
- For expiring subscriptions, use the globally stored user OAuth tokens to fetch an Access Token.
- `PATCH https://workspaceevents.googleapis.com/v1/subscriptions/{subscriptionId}?updateMask=ttl` with `{ "ttl": "604800s" }`.
- Update `state.json` with the newly returned `expirationDate`.

**Verification**:
- Add unit tests for the background renewal logic using fake timers to verify renewals trigger when dates are close.
- Mock the PATCH request and verify state updates.
- Run `npm run validate`.