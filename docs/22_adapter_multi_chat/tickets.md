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