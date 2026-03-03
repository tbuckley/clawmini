#!/usr/bin/env node

import { Client, Events, GatewayIntentBits, Partials } from 'discord.js';
import { readDiscordConfig, isAuthorized, initDiscordConfig } from './config.js';
import { getTRPCClient } from './client.js';
import { startDaemonToDiscordForwarder } from './forwarder.js';
import { Debouncer } from './utils.js';

export async function main() {
  const args = process.argv.slice(2);

  if (args[0] === 'init') {
    await initDiscordConfig();
    return;
  }

  console.log('Discord Adapter starting...');

  const config = await readDiscordConfig();
  if (!config) {
    console.error(
      'Failed to load Discord configuration. Please ensure .clawmini/adapters/discord/config.json exists and is valid.'
    );
    process.exit(1);
  }

  const trpc = getTRPCClient();

  const messageDebouncer = new Debouncer<string>(1000, async (messages) => {
    const combinedMessage =
      messages.length > 1
        ? messages.map((m) => `<message>\n${m}\n</message>`).join('\n')
        : messages[0] || '';
    console.log(`Forwarding aggregated message to daemon: ${combinedMessage}`);

    try {
      await trpc.sendMessage.mutate({
        type: 'send-message',
        client: 'cli',
        data: {
          message: combinedMessage,
          chatId: config.chatId,
        },
      });
      console.log('Message forwarded to daemon successfully.');
    } catch (error) {
      console.error('Failed to forward message to daemon:', error);
    }
  });

  const client = new Client({
    intents: [GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent],
    partials: [Partials.Channel],
  });

  client.once(Events.ClientReady, (readyClient) => {
    console.log(`Ready! Logged in as ${readyClient.user.tag}`);

    // Start forwarding from daemon to Discord
    startDaemonToDiscordForwarder(readyClient, trpc, config.authorizedUserId, config.chatId).catch(
      (error) => {
        console.error('Error in daemon-to-discord forwarder:', error);
      }
    );
  });

  client.on(Events.MessageCreate, async (message) => {
    // Ignore messages from the bot itself
    if (message.author.id === client.user?.id) return;

    // Only handle DM messages
    if (message.guild) return;

    // Check if the user is authorized
    if (!isAuthorized(message.author.id, config.authorizedUserId)) {
      console.log(
        `Unauthorized message from ${message.author.tag} (${message.author.id}) ignored.`
      );
      return;
    }

    console.log(`Received message from ${message.author.tag}: ${message.content}`);

    messageDebouncer.add(message.content);
  });

  try {
    await client.login(config.botToken);
  } catch (error) {
    console.error('Failed to login to Discord:', error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Unhandled error in Discord Adapter:', error);
  process.exit(1);
});
