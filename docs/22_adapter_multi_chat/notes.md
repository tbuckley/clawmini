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