#!/usr/bin/env node

import { Client, Events, GatewayIntentBits, Partials } from 'discord.js';
import { readDiscordConfig, isAuthorized, initDiscordConfig } from './config.js';
import { getTRPCClient } from './client.js';
import { startDaemonToDiscordForwarder } from './forwarder.js';
import { Debouncer } from './utils.js';
import fs from 'node:fs/promises';
import path from 'node:path';

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

  interface DebouncerItem {
    content: string;
    files: string[];
  }

  const messageDebouncer = new Debouncer<DebouncerItem>(
    1000,
    async (items) => {
      const combinedMessage =
        items.length > 1
          ? items.map((m) => `<message>\n${m.content}\n</message>`).join('\n')
          : items[0]?.content || '';
      const allFiles = items.flatMap((item) => item.files);
      console.log(`Forwarding aggregated message to daemon: ${combinedMessage}`);

      try {
        await trpc.sendMessage.mutate({
          type: 'send-message',
          client: 'cli',
          data: {
            message: combinedMessage,
            chatId: config.chatId,
            files: allFiles.length > 0 ? allFiles : undefined,
            adapter: 'discord',
          },
        });
        console.log('Message forwarded to daemon successfully.');
      } catch (error) {
        console.error('Failed to forward message to daemon:', error);
      }
    },
    (a, b) => a.content === b.content && a.files.join(',') === b.files.join(',')
  );

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

    const downloadedFiles: string[] = [];
    if (message.attachments.size > 0) {
      const tmpDir = path.join(process.cwd(), '.clawmini', 'adapters', 'discord', 'tmp');
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

    messageDebouncer.add({ content: message.content, files: downloadedFiles });
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
