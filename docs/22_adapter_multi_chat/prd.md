# Product Requirements Document: Adapter Multi-Chat Support

## Vision
To provide a seamless, multi-threaded conversational experience across chat platforms (Discord and Google Chat) by allowing users to map distinct channels or spaces to different internal daemon chats or agents. This ensures users can context-switch effectively without mixing separate tasks or agent workflows in a single monolithic adapter stream.

## Product/Market Background
Currently, the Clawmini bot integrates with external messaging platforms (Discord, Google Chat) using a simple 1:1 mapping strategy. The adapter connects to a single default daemon chat, meaning every message sent to the bot on that platform—regardless of the specific channel or thread—gets funneled into the same daemon conversation. As power users leverage specialized agents or distinct long-running chats, they need the ability to maintain concurrent, isolated workflows by directing different Discord channels or Google Chat spaces to different backend chats.

## Use Cases
1. **Context Separation:** A user is in a Discord server and creates two channels: `#coding-help` and `#general-research`. They want `#coding-help` routed to a dedicated coding chat/agent, and `#general-research` routed to their default chat.
2. **On-the-Fly Agent Spawning:** A user in Google Chat wants to consult an expert agent for a specific topic. They create a new Space, invite the bot, and use `/agent expert-coder` to immediately spin up a new chat session bound to that Space.
3. **Safe Defaults:** A user accidentally starts talking to the bot in a new channel without configuring it. The bot intercepts the message, warns them that the channel isn't configured, and provides instructions on how to route the channel.

## Requirements

### 1. Adapter State & 1:1 Mapping
- **State Schema Updates:** The `state.json` schema for both adapters must be updated:
  - Add `channelChatMap: Record<string, string>` to map external context IDs (Channel ID / Space ID) to Daemon Chat IDs.
  - Change `lastSyncedMessageId: string` to `lastSyncedMessageIds: Record<string, string>` to track the sync state for each individual chat independently.
- **Strict 1:1 Mapping Constraint:** To prevent "echo" loops where a single daemon message broadcasts to multiple external channels, multiple channels/spaces **cannot** be mapped to the same daemon chat. If a user attempts to route a channel to a chat that is already mapped elsewhere, the bot will reject the command with an error indicating which channel is currently using it.

### 2. The "First Contact" Protocol
- **Detection:** When an incoming message is received from an authorized user in a context (channel/space) that does not exist in the `channelChatMap`.
- **Interception:** If the message is *not* a routing command (i.e. not starting with `/chat` or `/agent`), the message is **not** forwarded to the daemon.
- **Onboarding Reply:** The bot replies with an instructional message:
  - "This channel/space is not currently mapped to a specific chat."
  - "To route this channel to an existing chat, use `/chat <chat-id>`."
  - "To route this channel to a specific agent, use `/agent <agent-id>`."
- **Persistent Warning:** The bot will continue to intercept and reply with this warning for every subsequent message until the user explicitly runs `/chat` or `/agent` to configure the channel. There is no automatic fallback.

### 3. Routing Commands
- **Command Handling:** The adapters must intercept messages starting with `/chat` and `/agent` *before* sending them to the daemon.
- **`/chat [chat-id]`**:
  - Fetches the list of all chats via `trpc.getChats.query()`.
  - If no `[chat-id]` is provided, or if the provided ID does not exist, replies with a formatted list of all available chats.
  - Checks if `[chat-id]` is already mapped to a *different* channel in `channelChatMap`. If so, returns an error.
  - If valid and available, updates `channelChatMap` to map the current channel/space to `[chat-id]`.
  - Replies with confirmation: "This channel is now routed to chat: `[chat-id]`."
- **`/agent [agent-id]`**:
  - Fetches the list of all agents via `trpc.getAgents.query()`.
  - If no `[agent-id]` is provided, or if the provided ID does not exist, replies with a formatted list of all available agents.
  - If `[agent-id]` exists, generates a new chat ID formatted as `<agent-id>-<adapter-name>`. If a chat with that ID already exists, it appends a number (e.g., `<agent-id>-<adapter-name>-1`, `-2`, etc.) until a unique ID is found.
  - Uses a TRPC endpoint to explicitly instruct the daemon to create the new chat and assign the specified agent to it.
  - Updates `channelChatMap` to point to the newly generated chat ID.
  - Replies with confirmation: "Created new chat and routed this channel to it: `<new-chat-id>` using agent `[agent-id]`."

### 4. Dynamic Forwarding Subscriptions
- **Forwarder Adjustments:** Currently, the forwarders establish a single subscription to the default `chatId` using `trpc.waitForMessages.subscribe`.
- **Multi-Subscription:** The forwarders must be updated to manage subscriptions for *all* `chatIds` actively mapped in `channelChatMap`.
- **Dynamic Updates:** When a routing command (`/chat` or `/agent`) updates the map, the forwarder must dynamically establish a subscription to the newly mapped `chatId`. It must track `lastSyncedMessageIds[chatId]` independently to resume correctly.

### 5. Platform-Specific Details
- **Discord:**
  - Remove the restriction that ignores messages in guilds (`if (message.guild) return;`).
  - Continue to rigorously enforce the `authorizedUserId` check. Only process commands and messages from the authorized user.
  - **Mention Requirement:** Introduce a new adapter configuration property `requireMention` (boolean, defaults to `false`).
    - If `false` (default): The bot responds to all messages from the authorized user in a mapped channel (assuming most channels are just the user + bot).
    - If `true`: The bot will only process messages in mapped *Guild (Server) channels* if the bot is explicitly `@mentioned` (or the message is a direct reply to the bot). Direct Messages (DMs) bypass this check and are always processed.
- **Google Chat:**
  - Ensure the ingestion logic (Pub/Sub) extracts the Space ID accurately to use as the external context ID in the map.

## Privacy, Security & Accessibility
- **Authorization:** Only the explicitly `authorizedUserId` (Discord) or authorized emails (Google Chat) can trigger the First Contact protocol or use the `/chat` and `/agent` commands. All other users in the channel are strictly ignored.
- **Information Disclosure:** Validating chat and agent IDs prevents users from accidentally creating junk records in the state. 
- **Noise Reduction:** The persistent warning and strict requirement for manual configuration prevents random channel chatter from polluting backend contexts. The `requireMention` setting in Discord provides an opt-in safety net for shared public channels.