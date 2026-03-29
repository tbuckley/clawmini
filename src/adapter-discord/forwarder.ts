/* eslint-disable max-lines */
import type {
  Client,
  MessageCreateOptions,
  TextChannel,
  DMChannel,
  NewsChannel,
  ThreadChannel,
  VoiceChannel,
  StageChannel,
} from 'discord.js';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Colors } from 'discord.js';
import path from 'node:path';
import fs from 'node:fs';
import type { getTRPCClient } from './client.js';
import { readDiscordState, updateDiscordState, getDiscordStatePath } from './state.js';
import type { ChatMessage } from '../shared/chats.js';
import { getWorkspaceRoot } from '../shared/workspace.js';
import {
  shouldDisplayMessage,
  formatMessage,
  type FilteringConfig,
} from '../shared/adapters/filtering.js';

async function resolveDiscordDestination(
  client: Client,
  discordUserId: string,
  chatId: string
): Promise<TextChannel | DMChannel | NewsChannel | ThreadChannel | VoiceChannel | StageChannel> {
  const state = await readDiscordState();
  const channelChatMap = state.channelChatMap || {};

  let targetDiscordChannelId: string | undefined;
  for (const [channelId, mappedChatId] of Object.entries(channelChatMap)) {
    if (mappedChatId === chatId) {
      targetDiscordChannelId = channelId;
      break;
    }
  }

  if (targetDiscordChannelId) {
    try {
      const channel = await client.channels.fetch(targetDiscordChannelId);
      if (channel && channel.isTextBased() && !channel.isDMBased()) {
        return channel as TextChannel | NewsChannel | ThreadChannel | VoiceChannel | StageChannel;
      }
    } catch (error) {
      console.warn(
        `Failed to fetch mapped channel ${targetDiscordChannelId} for chat ${chatId}, falling back to DM.`,
        error
      );
    }
  }

  const user = await client.users.fetch(discordUserId);
  return user.createDM();
}

export async function startDaemonToDiscordForwarder(
  client: Client,
  trpc: ReturnType<typeof getTRPCClient>,
  discordUserId: string,
  options: {
    chatId?: string;
    signal?: AbortSignal;
    config?: FilteringConfig;
  } = {}
) {
  const defaultChatId = options.chatId ?? 'default';
  const signal = options.signal;
  const config = options.config ?? {};

  const activeSubscriptions = new Map<string, { unsubscribe: () => void }>();
  const activeTypingSubscriptions = new Map<string, { unsubscribe: () => void }>();
  let currentLastSyncedMessageIds = (await readDiscordState()).lastSyncedMessageIds || {};

  const saveLastMessageId = async (chatId: string, id: string) => {
    currentLastSyncedMessageIds = { ...currentLastSyncedMessageIds, [chatId]: id };
    return updateDiscordState((state) => ({
      lastSyncedMessageIds: {
        ...state.lastSyncedMessageIds,
        ...currentLastSyncedMessageIds,
      },
    }));
  };

  const startSubscriptionForChat = async (chatId: string) => {
    if (activeSubscriptions.has(chatId)) return;
    if (signal?.aborted) return;

    let lastMessageId = currentLastSyncedMessageIds[chatId];

    if (!lastMessageId) {
      try {
        const messages = await trpc.getMessages.query({ chatId, limit: 1 });
        if (Array.isArray(messages) && messages.length > 0) {
          const lastMsg = messages[messages.length - 1];
          if (lastMsg) {
            await saveLastMessageId(chatId, lastMsg.id);
            lastMessageId = lastMsg.id;
          }
        }
      } catch (error) {
        if (signal?.aborted) return;
        console.error(`Failed to fetch initial messages from daemon for ${chatId}:`, error);
      }
    }

    console.log(
      `Starting daemon-to-discord forwarder for chat ${chatId}, lastMessageId: ${lastMessageId}`
    );

    let retryDelay = 1000;
    const maxRetryDelay = 30000;

    let subscription: { unsubscribe: () => void } | null = null;
    let messageQueue = Promise.resolve();

    const connect = () => {
      if (signal?.aborted || !activeSubscriptions.has(chatId)) {
        return;
      }

      subscription = trpc.waitForMessages.subscribe(
        { chatId, lastMessageId },
        {
          onData: (messages) => {
            retryDelay = 1000; // Reset retry delay on successful data

            if (!Array.isArray(messages) || messages.length === 0) {
              return;
            }

            // Queue processing to ensure sequential execution
            messageQueue = messageQueue.then(async () => {
              for (const rawMessage of messages) {
                if (signal?.aborted || !activeSubscriptions.has(chatId)) break;

                const message = rawMessage as ChatMessage;

                const isDisplayed = shouldDisplayMessage(message, config);

                if (isDisplayed) {
                  const logMessage = message;
                  const isPolicyRequest =
                    logMessage.role === 'policy' && logMessage.status === 'pending';

                  if (isPolicyRequest) {
                    try {
                      const dm = await resolveDiscordDestination(client, discordUserId, chatId);

                      const embed = new EmbedBuilder()
                        .setTitle('Action Required: Policy Request')
                        .setDescription(
                          logMessage.content || 'A pending policy request requires your attention.'
                        )
                        .setColor(Colors.Yellow);

                      const policyId =
                        ('requestId' in logMessage && logMessage.requestId) || logMessage.id;
                      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
                        new ButtonBuilder()
                          .setCustomId(`approve|${policyId}|${chatId}`)
                          .setLabel('Approve')
                          .setStyle(ButtonStyle.Success),
                        new ButtonBuilder()
                          .setCustomId(`reject|${policyId}|${chatId}`)
                          .setLabel('Reject')
                          .setStyle(ButtonStyle.Danger)
                      );

                      const optionsMsg: MessageCreateOptions = {
                        embeds: [embed],
                        components: [row],
                      };

                      try {
                        await dm.send(optionsMsg);
                      } catch (richError) {
                        console.warn(
                          `Failed to send rich message to Discord user ${discordUserId}, falling back to plain text:`,
                          richError
                        );
                        await dm.send({
                          content: `Action Required: Policy Request\n\n${logMessage.content || 'A pending policy request requires your attention.'}\n\nApprove: \`/approve ${policyId}\`\nReject: \`/reject ${policyId} <optional_rationale>\``,
                        });
                      }
                    } catch (error) {
                      console.error(
                        `Failed to send message to Discord user ${discordUserId}:`,
                        error
                      );
                    }

                    await saveLastMessageId(chatId, logMessage.id).catch(console.error);
                    lastMessageId = logMessage.id;
                    continue;
                  }

                  if ('level' in logMessage && logMessage.level === 'verbose') {
                    await saveLastMessageId(chatId, logMessage.id).catch(console.error);
                    lastMessageId = logMessage.id;
                    continue;
                  }

                  const hasContent = !!logMessage.content?.trim();
                  const files = 'files' in logMessage ? (logMessage.files as string[]) : undefined;
                  const hasFiles = Array.isArray(files) && files.length > 0;

                  let absoluteFiles: string[] = [];
                  if (hasFiles && files) {
                    const workspaceRoot = getWorkspaceRoot(process.cwd());
                    absoluteFiles = files.map((f) => path.resolve(workspaceRoot, f));
                  }

                  if (!hasContent && !hasFiles) {
                    await saveLastMessageId(chatId, logMessage.id).catch(console.error);
                    lastMessageId = logMessage.id;
                    continue;
                  }

                  try {
                    const dm = await resolveDiscordDestination(client, discordUserId, chatId);
                    const formattedContent = formatMessage(message);

                    if (formattedContent && formattedContent.length > 2000) {
                      const chunks = chunkString(formattedContent, 2000);
                      for (let i = 0; i < chunks.length; i++) {
                        if (signal?.aborted || !activeSubscriptions.has(chatId)) break;
                        const chunkOptions: MessageCreateOptions = { content: chunks[i] as string };
                        if (i === chunks.length - 1 && hasFiles) {
                          chunkOptions.files = absoluteFiles;
                        }
                        await dm.send(chunkOptions);
                      }
                    } else {
                      const optionsMsg: MessageCreateOptions = {};
                      if (formattedContent) {
                        optionsMsg.content = formattedContent;
                      }
                      if (hasFiles) {
                        optionsMsg.files = absoluteFiles;
                      }
                      await dm.send(optionsMsg);
                    }
                  } catch (error) {
                    console.error(
                      `Failed to send message to Discord user ${discordUserId}:`,
                      error
                    );
                    break; // don't advance lastMessageId
                  }
                }

                await saveLastMessageId(chatId, message.id).catch(console.error);
                lastMessageId = message.id;
              }
            });
          },
          onError: (error) => {
            console.error(
              `Error in daemon-to-discord forwarder subscription for ${chatId}. Retrying in ${retryDelay}ms.`,
              error
            );
            subscription?.unsubscribe();
            subscription = null;

            if (signal?.aborted || !activeSubscriptions.has(chatId)) {
              return;
            }

            setTimeout(() => {
              retryDelay = Math.min(retryDelay * 2, maxRetryDelay);
              connect();
            }, retryDelay);
          },
          onComplete: () => {
            subscription = null;
            if (!signal?.aborted && activeSubscriptions.has(chatId)) {
              setTimeout(() => connect(), retryDelay);
            }
          },
        }
      );
    };

    let typingSubscription: { unsubscribe: () => void } | null = null;
    let typingRetryDelay = 1000;

    const connectTyping = () => {
      if (signal?.aborted || !activeSubscriptions.has(chatId)) {
        return;
      }

      typingSubscription = trpc.waitForTyping.subscribe(
        { chatId },
        {
          onData: async (event) => {
            typingRetryDelay = 1000; // Reset retry delay on successful data
            if (!event) return;

            try {
              const dm = await resolveDiscordDestination(client, discordUserId, chatId);
              if (dm.sendTyping) {
                await dm.sendTyping();
              }
            } catch (error) {
              console.error(
                `Failed to send typing indicator to Discord user ${discordUserId}:`,
                error
              );
            }
          },
          onError: (error) => {
            console.error(
              `Error in daemon-to-discord typing forwarder subscription for ${chatId}. Retrying in ${typingRetryDelay}ms.`,
              error
            );
            typingSubscription?.unsubscribe();
            typingSubscription = null;

            if (signal?.aborted || !activeSubscriptions.has(chatId)) {
              return;
            }

            setTimeout(() => {
              typingRetryDelay = Math.min(typingRetryDelay * 2, maxRetryDelay);
              connectTyping();
            }, typingRetryDelay);
          },
          onComplete: () => {
            typingSubscription = null;
            if (!signal?.aborted && activeSubscriptions.has(chatId)) {
              setTimeout(() => connectTyping(), typingRetryDelay);
            }
          },
        }
      );
    };

    activeSubscriptions.set(chatId, {
      unsubscribe: () => subscription?.unsubscribe(),
    });
    activeTypingSubscriptions.set(chatId, {
      unsubscribe: () => typingSubscription?.unsubscribe(),
    });

    connect();
    connectTyping();
  };

  const syncSubscriptions = async () => {
    if (signal?.aborted) return;
    const state = await readDiscordState();

    // Update local copy of last message IDs
    if (state.lastSyncedMessageIds) {
      currentLastSyncedMessageIds = {
        ...currentLastSyncedMessageIds,
        ...state.lastSyncedMessageIds,
      };
    }

    const targetChatIds = new Set<string>();
    targetChatIds.add(defaultChatId);

    if (state.channelChatMap) {
      for (const mappedChatId of Object.values(state.channelChatMap)) {
        targetChatIds.add(mappedChatId);
      }
    }

    // Start new subscriptions
    for (const targetChatId of targetChatIds) {
      if (!activeSubscriptions.has(targetChatId)) {
        startSubscriptionForChat(targetChatId);
      }
    }

    // Teardown old subscriptions
    for (const [activeChatId, sub] of activeSubscriptions.entries()) {
      if (!targetChatIds.has(activeChatId)) {
        sub.unsubscribe();
        activeSubscriptions.delete(activeChatId);
        activeTypingSubscriptions.get(activeChatId)?.unsubscribe();
        activeTypingSubscriptions.delete(activeChatId);
      }
    }
  };

  return new Promise<void>((resolve) => {
    syncSubscriptions().catch(console.error);

    const statePath = getDiscordStatePath();
    const stateDir = path.dirname(statePath);
    if (!fs.existsSync(stateDir)) {
      fs.mkdirSync(stateDir, { recursive: true });
    }
    const watcher = fs.watch(stateDir, (eventType: string, filename: string | null) => {
      if (filename === path.basename(statePath)) {
        syncSubscriptions().catch(console.error);
      }
    });

    signal?.addEventListener('abort', () => {
      watcher.close();
      for (const sub of activeSubscriptions.values()) sub.unsubscribe();
      for (const sub of activeTypingSubscriptions.values()) sub.unsubscribe();
      resolve();
    });
  });
}

function chunkString(str: string, size: number): string[] {
  const chunks: string[] = [];
  const chars = Array.from(str);
  for (let i = 0; i < chars.length; i += size) {
    chunks.push(chars.slice(i, i + size).join(''));
  }
  return chunks;
}
