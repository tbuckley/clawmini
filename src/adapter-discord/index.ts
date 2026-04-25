#!/usr/bin/env node

import { Client, Events, GatewayIntentBits, Partials, REST, Routes } from 'discord.js';
import { readDiscordConfig, initDiscordConfig } from './config.js';
import { readDiscordState } from './state.js';
import { handleDiscordInteraction } from './interactions.js';
import { getTRPCClient } from './client.js';
import { startDaemonToDiscordForwarder } from './forwarder.js';
import { slashCommands } from './commands.js';
import { type CommandTrpcClient } from '../shared/adapters/commands.js';
import { type FilteringConfig } from '../shared/adapters/filtering.js';

import { processDiscordMessage } from './processMessage.js';

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

  const client = new Client({
    intents: [
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
    ],
    partials: [Partials.Channel],
  });

  const state = await readDiscordState();
  const filteringConfig: FilteringConfig = { filters: state.filters };

  client.once(Events.ClientReady, async (readyClient) => {
    console.log(`Ready! Logged in as ${readyClient.user.tag}`);

    try {
      const rest = new REST({ version: '10' }).setToken(config.botToken);
      console.log('Started refreshing application (/) commands.');
      await rest.put(Routes.applicationCommands(readyClient.user.id), {
        body: slashCommands.map((cmd) => cmd.toJSON()),
      });
      console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
      console.error('Error registering slash commands:', error);
    }

    // Start forwarding from daemon to Discord
    startDaemonToDiscordForwarder(readyClient, trpc, config.authorizedUserId, {
      chatId: config.chatId,
      config: filteringConfig,
      discordConfig: config,
    }).catch((error) => {
      console.error('Error in daemon-to-discord forwarder:', error);
    });
  });

  client.on(Events.MessageCreate, async (message) => {
    let isReplyToBot = false;
    let referenceContent: string | undefined;
    let referenceAuthor: string | undefined;

    if (message.reference && message.reference.messageId) {
      try {
        const referencedMessage = await message.fetchReference();
        isReplyToBot = referencedMessage?.author.id === client.user!.id;
        referenceContent = referencedMessage?.content;
        if (referencedMessage) {
          if (referencedMessage.author.bot) {
            referenceAuthor = 'Assistant';
          } else if (referencedMessage.author.id !== config.authorizedUserId) {
            referenceAuthor = referencedMessage.author.username;
          }
        }
      } catch (err) {
        console.error('Failed to fetch referenced message for mention check:', err);
      }
    }

    const attachments = message.attachments
      ? Array.from(message.attachments.values()).map((att) => ({
          name: att.name,
          size: att.size,
          url: att.url,
        }))
      : [];

    await processDiscordMessage(
      message.content,
      message.author,
      message.channelId,
      message.guild,
      async (text) => {
        await message.reply(text);
      },
      config,
      trpc,
      filteringConfig,
      {
        mentionsBot: !!message.mentions?.has(client.user!.id),
        isReplyToBot,
        attachments,
        messageId: message.id,
        ...(referenceContent ? { referenceContent } : {}),
        ...(referenceAuthor ? { referenceAuthor } : {}),
      }
    );
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    await handleDiscordInteraction(
      interaction,
      config,
      trpc as unknown as CommandTrpcClient,
      filteringConfig
    );
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
