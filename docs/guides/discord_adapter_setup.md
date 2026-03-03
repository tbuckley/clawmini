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
3. If prompted for an **Installation Method**, ensure you select **Guild Install**. The `bot` scope is not valid for "User Install" and will cause an error.
4. Select the `Send Messages` and `Read Message History` permissions under **Bot Permissions**.
5. Copy the generated URL and paste it into your browser.
6. Select your personal server (or any server you share with the bot) to invite the bot.
7. Once the bot is in a shared server, you can right-click the bot and select **Message** to start a DM conversation.

## Step 4: Configure the Adapter

The adapter requires a configuration file with your bot token and user ID. You can generate a template configuration file by running the `init` command:

```bash
npx clawmini-adapter-discord init
```

This will create a `config.json` file at `.clawmini/adapters/discord/config.json`. Open this file and replace the placeholders with your actual bot token and user ID:

```json
{
  "botToken": "YOUR_DISCORD_BOT_TOKEN",
  "authorizedUserId": "YOUR_DISCORD_USER_ID",
  "chatId": "default"
}
```
*(Note: `chatId` defaults to `"default"`. You can change this if you want the bot to associate with a different chat).*

## Step 5: Start the Adapter

Ensure the Clawmini daemon is running, then start the Discord adapter:

```bash
npx clawmini-adapter-discord
```

The adapter will now forward authorized Discord DM messages to your Clawmini daemon and vice versa.
