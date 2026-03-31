# Notes on Adapter Multi-Chat Support

## Current State

### Discord Adapter
- The bot initializes a single `daemon-to-discord` forwarder, listening to a single `chatId` (configured in `config.chatId` or falling back to `'default'`).
- In `src/adapter-discord/index.ts`, the incoming message handler explicitly ignores messages that occur in a guild (`if (message.guild) return;`). It only processes DMs.
- It validates the sender against `config.authorizedUserId`.
- When forwarding to the daemon, it always uses `config.chatId`.

### Google Chat Adapter
- The bot initializes a single forwarder, listening to `config.chatId` or `'default'`.
- It maintains an `activeSpaceName` in state which determines where the forwarder sends replies. This means it essentially only supports a 1:1 mapping between one daemon chat and one active Google Chat space at a time.
- Incoming messages from Pub/Sub (ingestion) are sent to the single `chatId`.

## Requirements for Multi-Chat Support

1. **Mapping Configuration**:
   - We need a way to map an external context (e.g., Discord Channel ID, Discord Thread ID, Google Space ID) to a specific Daemon Chat ID.
   - This mapping could be stored in the adapter's state (`state.json`) so it persists across restarts.
2. **Dynamic Subscriptions**:
   - The forwarder functions (`startDaemonToDiscordForwarder` and `startDaemonToGoogleChatForwarder`) currently subscribe to a single `chatId` via `trpc.waitForMessages.subscribe`.
   - To support multiple chats, the adapter must maintain a dynamic list of subscriptions, adding new ones as new mappings are created.
3. **Handling Incoming Messages**:
   - **Discord**: Remove the `if (message.guild) return;` block. Allow messages in channels/threads, but *only* if the user is authorized and perhaps if the bot is explicitly mentioned or configured to listen to that channel.
   - When an incoming message arrives, determine its external context ID (e.g. `message.channelId` in Discord).
   - Look up the mapped Daemon Chat ID. If none exists, use a default behavior (e.g., use the user's default chat, or create a new chat for that context).
4. **User Commands for Routing**:
   - The user needs a way to say "route this channel to chat X" or "route this channel to agent Y".
   - This could be implemented via adapter-level chat commands (e.g., `!chat <id>`, `!agent <id>`).
   - The adapter would need to validate these IDs against the daemon's TRPC API (`trpc.getChats`, `trpc.getAgents`).

## Space Subscriptions (Google Chat) Research
- `src/adapter-google-chat/state.ts`: The `GoogleChatStateSchema` needs its `channelChatMap` updated to store subscription info alongside the chat ID. It should be: `channelChatMap: z.record(z.string(), z.object({ chatId: z.string().nullable().optional(), subscriptionId: z.string().optional(), expirationDate: z.string().optional() })).optional()`. We need a migration to convert existing `Record<string, string>` formats into this object format.
- `src/adapter-google-chat/auth.ts`: Currently handles Bot auth (Service Account) and Drive Auth (OAuth2 with offline access). We need to adapt the OAuth flow to request Google Chat scopes (likely `https://www.googleapis.com/auth/chat.messages.readonly` or similar depending on the exact event subscription) and capture the refresh token for the user. 
- `src/adapter-google-chat/client.ts`: The `startGoogleChatIngestion` function currently handles `MESSAGE` and `CARD_CLICKED` events. We must update it to:
  1. Handle `ADDED_TO_SPACE` natively (if `space.type !== "DIRECT_MESSAGE"`) to create space subscriptions using the globally saved user OAuth tokens and save the result to state.
  2. Handle `REMOVED_FROM_SPACE` to cleanly delete the subscription and state entry.
  3. Distinguish between Workspace Events (via the `ce-type` Pub/Sub attribute) and native Bot Events.
  4. Deduplicate messages based on Message ID using a 60-second in-memory cache to prevent processing the same message twice when the bot is `@mentioned` in a subscribed space.
  5. Drop messages where `sender === 'BOT'` to prevent infinite loops.
- Background Renewal: We need to implement a mechanism (e.g., an hourly `setInterval` inside the adapter process or a separate cron) to check `expirationDate` of space subscriptions and renew those expiring in < 48 hours via `PATCH /v1/subscriptions/{id}`.
