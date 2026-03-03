# Questions for Discord Adapter

1. **Adapter Scope:** Should the Discord adapter sync with only the `default` chat, or should the user be able to specify a `chatId` to sync with (or multiple)?
   - **Answer:** There should always be a 1:1 mapping between discord channels/DMs and clawmini chats.

2. **Daemon Output Synchronization:** Since the daemon writes messages directly to `.gemini/chats/<chatId>/chat.jsonl`, should the adapter simply tail/watch this file to detect new messages to forward to Discord, or should we add a new TRPC endpoint for reading/subscribing to messages?
   - **Answer:** Let's add support to the daemon; and the CLI's `web` command should likely use the same endpoint to receive messages. We can move its logic for observing the chat's jsonl file to the daemon.

3. **Persisting Sync State:** To know which messages were already forwarded upon startup, should the adapter store a local cursor (e.g. last read message ID or timestamp) in a file like `.gemini/discord-cursor.json`?
   - **Answer:** Yes, let's let adapters store config + state in `.clawmini/adapters/discord/{config,state}.json`.

4. **Discord Bot vs User Token:** I assume we are using a standard Discord Bot application (requires a bot token) rather than a selfbot (user token), which requires the user to create a bot in the Discord Developer Portal and invite it to a server or DM it directly. Is this correct?
   - **Answer:** Yes, standard Discord Bot.

5. **Direct Messages vs Channel:** Should the bot only respond to Direct Messages from the configured user, or also respond to messages in a specific channel where the configured user mentions the bot?
   - **Answer:** Start with just DMs for now, but eventually support adding the bot to a server to respond in each channel. It must ignore any messages not from the configured user.