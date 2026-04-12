import { readDiscordState, updateDiscordState } from './state.js';
import type { DiscordConfig } from './config.js';
import { handleAdapterCommand, type CommandTrpcClient } from '../shared/adapters/commands.js';
import { formatMessage, type FilteringConfig } from '../shared/adapters/filtering.js';
import { handleRoutingCommand, type RoutingTrpcClient } from '../shared/adapters/routing.js';
import { getClawminiDir } from '../shared/workspace.js';
import path from 'node:path';
import fs from 'node:fs/promises';

export type ProcessMessageOptions = {
  mentionsBot?: boolean;
  isReplyToBot?: boolean;
  attachments?: { name: string; size: number; url: string }[];
  referenceContent?: string;
  explicitChatId?: string;
};

export async function processDiscordMessage(
  content: string,
  author: { id: string; tag: string; bot?: boolean },
  channelId: string | null,
  guild: any | null,
  reply: (text: string) => Promise<any>,
  config: DiscordConfig,
  trpc: any,
  filteringConfig: FilteringConfig,
  options: ProcessMessageOptions = {}
) {
  if (author.bot) return;

  const externalContextId = channelId || 'default';
  const currentState = await readDiscordState();
  const mappedChatId = options.explicitChatId || (channelId ? currentState.channelChatMap?.[channelId]?.chatId : null);
  const isRoutingCommand = content.startsWith('/chat') || content.startsWith('/agent');

  // Enforce requireMention config for guild messages
  if (guild && channelId) {
    const channelConfig = currentState.channelChatMap?.[channelId];
    const requiresMention =
      channelConfig?.requireMention !== undefined
        ? channelConfig.requireMention
        : config.requireMention;

    if (requiresMention) {
      if (!options.mentionsBot && !options.isReplyToBot) {
        return;
      }
    }
  }

  function isAuthorized(userId: string, authorizedUserId: string): boolean {
    return userId === authorizedUserId;
  }

  // Check if the user is authorized
  if (!isAuthorized(author.id, config.authorizedUserId)) {
    console.log(`Unauthorized message from ${author.tag} (${author.id}) ignored.`);
    return;
  }

  console.log(`Received message from ${author.tag}: ${content}`);

  if (isRoutingCommand) {
    const stringChatMap = Object.fromEntries(
      Object.entries(currentState.channelChatMap || {}).map(([k, v]) => [k, v.chatId || ''])
    );
    const routingResult = await handleRoutingCommand(
      content,
      externalContextId,
      stringChatMap,
      'discord',
      trpc as unknown as RoutingTrpcClient
    );

    if (routingResult) {
      if (routingResult.type === 'mapped') {
        await updateDiscordState((latestState) => ({
          channelChatMap: {
            ...(latestState.channelChatMap || {}),
            [externalContextId]: {
              ...(latestState.channelChatMap?.[externalContextId] || {}),
              chatId: routingResult.newChatId,
            },
          },
        }));
      }
      await reply(routingResult.text);
      return;
    }
  }

  let targetChatId = mappedChatId;

  if (!targetChatId && !isRoutingCommand) {
    const isFirstEverMessage =
      !currentState.channelChatMap ||
      Object.values(currentState.channelChatMap).every((entry) => !entry.chatId);

    if (isFirstEverMessage) {
      targetChatId = config.chatId || 'default';
      console.log(
        `First contact detected. Automatically mapping channel ${externalContextId} to chat ${targetChatId}.`
      );
      await updateDiscordState((latestState) => ({
        channelChatMap: {
          ...(latestState.channelChatMap || {}),
          [externalContextId]: {
            ...(latestState.channelChatMap?.[externalContextId] || {}),
            chatId: targetChatId as string,
          },
        },
      }));
    } else {
      const isDirectMessage = !guild;
      const isSlashCommand = content.startsWith('/');
      if (isDirectMessage || options.mentionsBot || isSlashCommand) {
        console.log(`Unmapped channel ${externalContextId}, sending first contact warning.`);
        await reply(
          'This channel/space is not currently mapped to a daemon chat. Please use `/chat [chat-id]` or `/agent [agent-id]` to map it.'
        );
      } else {
        console.log(
          `Unmapped channel ${externalContextId}, silently ignoring background message.`
        );
      }
      return;
    }
  }

  // Fallback typing safeguard
  if (!targetChatId) targetChatId = config.chatId || 'default';

  const commandResult = await handleAdapterCommand(
    content,
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
      await reply(commandResult.text);
    } else if (commandResult.type === 'debug') {
      const formatted =
        commandResult.messages.length === 0
          ? 'No ignored background messages found.'
          : `**Debug Output (${commandResult.messages.length} ignored messages):**\n\n` +
            commandResult.messages.map((msg) => formatMessage(msg)).join('\n\n---\n\n');
      await reply(formatted);
    }
    return;
  }

  const downloadedFiles: string[] = [];
  if (options.attachments && options.attachments.length > 0) {
    const tmpDir = path.join(getClawminiDir(process.cwd()), 'tmp', 'discord');
    await fs.mkdir(tmpDir, { recursive: true });
    const maxSizeMB = config.maxAttachmentSizeMB ?? 25;
    const maxSizeBytes = maxSizeMB * 1024 * 1024;

    for (const attachment of options.attachments) {
      if (attachment.size > maxSizeBytes) {
        console.warn(
          `Attachment ${attachment.name} exceeds size limit (${maxSizeMB}MB). Ignoring.`
        );
        await reply(
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

  let finalContent = content;

  if (options.referenceContent) {
    const quotedContent = options.referenceContent
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n');
    finalContent = `${quotedContent}\n${finalContent}`;
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
}
