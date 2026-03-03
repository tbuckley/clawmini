# Discord Adapter Setup Guide

This guide describes how to set up and configure the Discord adapter for Clawmini.

## Prerequisites

- A Discord account.
- A Clawmini daemon running locally (the adapter communicates with it via TRPC over Unix sockets).

## Step 1: Create a Discord Bot

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications).
2. Click **New Application**.
3. Give your application a name (e.g., "Clawmini-Bot") and click **Create**.
4. In the left sidebar, click **Bot**.
5. Under **Bot Token**, click **Reset Token** (or **Copy Token**) to retrieve your bot's token. **Save this token securely; you will need it later.**
6. Scroll down to the **Privileged Gateway Intents** section.
7. Enable **Message Content Intent**. This is required for the bot to read DM messages.
8. Click **Save Changes**.

## Step 2: Get Your Discord User ID

The adapter only responds to messages from a single authorized user. To find your Discord User ID:

1. Open Discord and go to **User Settings** (the gear icon at the bottom left).
2. Go to **Advanced**.
3. Enable **Developer Mode**.
4. Right-click on your profile picture or username in a server or DM and select **Copy User ID**.

## Step 3: Invite the Bot to Your Direct Messages

Discord bots cannot initiate a DM conversation with a user unless the user has first interacted with the bot.

1. In the Discord Developer Portal, go to **OAuth2** -> **URL Generator**.
2. Select the `bot` scope.
3. Select the `Send Messages` and `Read Message History` permissions under **Bot Permissions**.
4. Copy the generated URL and paste it into your browser.
5. Select your personal server (or any server you share with the bot) to invite the bot.
6. Once the bot is in a shared server, you can right-click the bot and select **Message** to start a DM conversation.

## Step 4: Configure the Adapter

1. Ensure the Clawmini configuration directory exists (typically `.clawmini` in your workspace).
2. Create the following directory structure if it doesn't exist:
   ```bash
   mkdir -p .clawmini/adapters/discord
   ```
3. Create a `config.json` file in that directory:
   ```bash
   touch .clawmini/adapters/discord/config.json
   ```
4. Add the following content to `config.json`, replacing the placeholders with your actual bot token and user ID:
   ```json
   {
     "botToken": "YOUR_DISCORD_BOT_TOKEN",
     "authorizedUserId": "YOUR_DISCORD_USER_ID"
   }
   ```

## Step 5: Start the Adapter

Ensure the Clawmini daemon is running, then start the Discord adapter:

```bash
node dist/adapter-discord/index.mjs
```

The adapter will now forward authorized Discord DM messages to your Clawmini daemon and vice versa.
