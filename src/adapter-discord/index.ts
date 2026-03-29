#!/usr/bin/env node

import { Client, Events, GatewayIntentBits, Partials } from 'discord.js';
import { readDiscordConfig, isAuthorized, initDiscordConfig } from './config.js';
import { readDiscordState, updateDiscordState } from './state.js';
import { handleDiscordInteraction } from './interactions.js';
import { getTRPCClient } from './client.js';
import { startDaemonToDiscordForwarder } from './forwarder.js';
import { getClawminiDir } from '../shared/workspace.js';
import { handleAdapterCommand, type CommandTrpcClient } from '../shared/adapters/commands.js';
import { formatMessage, type FilteringConfig } from '../shared/adapters/filtering.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { handleRoutingCommand, type RoutingTrpcClient } from '../shared/adapters/routing.js';

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

  client.once(Events.ClientReady, (readyClient) => {
    console.log(`Ready! Logged in as ${readyClient.user.tag}`);

    // Start forwarding from daemon to Discord
    startDaemonToDiscordForwarder(readyClient, trpc, config.authorizedUserId, {
      chatId: config.chatId,
      config: filteringConfig,
    }).catch((error) => {
      console.error('Error in daemon-to-discord forwarder:', error);
    });
  });

  client.on(Events.MessageCreate, async (message) => {
    // Ignore messages from the bot itself
    if (message.author.id === client.user?.id) return;
    if (message.author.bot) return;

    // Enforce requireMention config for guild messages
    if (message.guild && config.requireMention) {
      const isMentioned = message.mentions.has(client.user!.id);
      let isReplyToBot = false;

      if (message.reference && message.reference.messageId) {
        try {
          const referencedMessage = await message.channel.messages.fetch(
            message.reference.messageId
          );
          isReplyToBot = referencedMessage.author.id === client.user!.id;
        } catch (err) {
          console.error('Failed to fetch referenced message for mention check:', err);
        }
      }

      if (!isMentioned && !isReplyToBot) {
        return;
      }
    }

    // Check if the user is authorized
    if (!isAuthorized(message.author.id, config.authorizedUserId)) {
      console.log(
        `Unauthorized message from ${message.author.tag} (${message.author.id}) ignored.`
      );
      return;
    }

    console.log(`Received message from ${message.author.tag}: ${message.content}`);

    const externalContextId = message.channelId;
    const currentState = await readDiscordState();
    const mappedChatId = currentState.channelChatMap?.[externalContextId];

    const isRoutingCommand =
      message.content.startsWith('/chat') || message.content.startsWith('/agent');

    if (isRoutingCommand) {
      const routingResult = await handleRoutingCommand(
        message.content,
        externalContextId,
        currentState.channelChatMap || {},
        'discord',
        trpc as unknown as RoutingTrpcClient
      );

      if (routingResult) {
        if (routingResult.type === 'mapped') {
          await updateDiscordState((latestState) => ({
            channelChatMap: {
              ...(latestState.channelChatMap || {}),
              [externalContextId]: routingResult.newChatId,
            },
          }));
        }
        await message.reply(routingResult.text);
        return;
      }
    }

    let targetChatId = mappedChatId;

    if (!targetChatId && !isRoutingCommand) {
      const isFirstEverMessage =
        !currentState.channelChatMap || Object.keys(currentState.channelChatMap).length === 0;

      if (isFirstEverMessage) {
        targetChatId = config.chatId || 'default';
        console.log(
          `First contact detected. Automatically mapping channel ${externalContextId} to chat ${targetChatId}.`
        );
        await updateDiscordState((latestState) => ({
          channelChatMap: {
            ...(latestState.channelChatMap || {}),
            [externalContextId]: targetChatId as string,
          },
        }));
      } else {
        console.log(`Unmapped channel ${externalContextId}, sending first contact warning.`);
        await message.reply(
          'This channel/space is not currently mapped to a daemon chat. Please use `/chat [chat-id]` or `/agent [agent-id]` to map it.'
        );
        return;
      }
    }

    // Fallback typing safeguard
    if (!targetChatId) targetChatId = config.chatId || 'default';

    const commandResult = await handleAdapterCommand(
      message.content,
      filteringConfig,
      trpc as unknown as CommandTrpcClient,
      targetChatId
    );

    if (commandResult) {
      if (commandResult.type === 'text') {
        if (commandResult.newConfig) {
          filteringConfig.filters = commandResult.newConfig.filters;
          await updateDiscordState({ filters: filteringConfig.filters });
        }
        await message.reply(commandResult.text);
      } else if (commandResult.type === 'debug') {
        const formatted =
          commandResult.messages.length === 0
            ? 'No ignored background messages found.'
            : `**Debug Output (${commandResult.messages.length} ignored messages):**\n\n` +
              commandResult.messages.map((msg) => formatMessage(msg)).join('\n\n---\n\n');
        await message.reply(formatted);
      }
      return;
    }

    const downloadedFiles: string[] = [];
    if (message.attachments.size > 0) {
      const tmpDir = path.join(getClawminiDir(process.cwd()), 'tmp', 'discord');
      await fs.mkdir(tmpDir, { recursive: true });
      const maxSizeMB = config.maxAttachmentSizeMB ?? 25;
      const maxSizeBytes = maxSizeMB * 1024 * 1024;

      for (const attachment of message.attachments.values()) {
        if (attachment.size > maxSizeBytes) {
          console.warn(
            `Attachment ${attachment.name} exceeds size limit (${maxSizeMB}MB). Ignoring.`
          );
          await message.reply(
            `Warning: Attachment ${attachment.name} exceeds the size limit of ${maxSizeMB}MB and was ignored.`
          );
          continue;
        }

        try {
          const res = await fetch(attachment.url);
          if (!res.ok) {
            console.error(`Failed to download attachment ${attachment.name}`);
            continue;
          }

          const uniqueName = `${Date.now()}-${attachment.name}`;
          const filePath = path.join(tmpDir, uniqueName);
          const arrayBuffer = await res.arrayBuffer();
          await fs.writeFile(filePath, Buffer.from(arrayBuffer));
          downloadedFiles.push(filePath);
        } catch (err) {
          console.error(`Error downloading attachment ${attachment.name}:`, err);
        }
      }
    }

    let finalContent = message.content;

    if (message.reference && message.reference.messageId) {
      try {
        const referencedMessage = await message.fetchReference();
        if (referencedMessage && referencedMessage.content) {
          const quotedContent = referencedMessage.content
            .split('\n')
            .map((line) => `> ${line}`)
            .join('\n');
          finalContent = `${quotedContent}\n${finalContent}`;
        }
      } catch (err) {
        console.error('Failed to fetch referenced message:', err);
      }
    }

    console.log(`Forwarding message to daemon: ${finalContent}`);
    try {
      await trpc.sendMessage.mutate({
        type: 'send-message',
        client: 'cli',
        data: {
          message: finalContent,
          chatId: targetChatId,
          files: downloadedFiles.length > 0 ? downloadedFiles : undefined,
          adapter: 'discord',
          noWait: true,
        },
      });
      console.log('Message forwarded to daemon successfully.');
    } catch (error) {
      console.error('Failed to forward message to daemon:', error);
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    await handleDiscordInteraction(interaction, config, trpc as unknown as CommandTrpcClient);
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
