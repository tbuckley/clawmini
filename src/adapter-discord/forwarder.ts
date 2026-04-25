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
  Message,
} from 'discord.js';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Colors } from 'discord.js';
import path from 'node:path';
import fs from 'node:fs';
import type { getTRPCClient } from './client.js';
import type { DiscordConfig } from './config.js';
import { readDiscordState, updateDiscordState, getDiscordStatePath } from './state.js';
import { resolveInbound } from './inbound-cache.js';
import { createTurnLogBuffer, type TurnLogBuffer } from './turn-log-buffer.js';
import type { ChatMessage } from '../shared/chats.js';
import { getWorkspaceRoot } from '../shared/workspace.js';
import {
  routeMessage,
  formatMessage,
  type Destination,
  type FilteringConfig,
} from '../shared/adapters/filtering.js';

type AnyTextChannel =
  | TextChannel
  | DMChannel
  | NewsChannel
  | ThreadChannel
  | VoiceChannel
  | StageChannel;

interface ThreadLogOptions {
  maxToolPreview: number;
  maxLogMessageChars: number;
  editDebounceMs: number;
}

const DEFAULT_THREAD_LOG_OPTS: ThreadLogOptions = {
  maxToolPreview: 400,
  // Discord caps messages at 2000 chars; leave headroom for the rollover marker.
  maxLogMessageChars: 1800,
  editDebounceMs: 1000,
};

function resolveThreadLogOpts(config?: DiscordConfig): ThreadLogOptions {
  const v = config?.visibility?.threadLog;
  return {
    maxToolPreview: v?.maxToolPreview ?? DEFAULT_THREAD_LOG_OPTS.maxToolPreview,
    maxLogMessageChars: v?.maxLogMessageChars ?? DEFAULT_THREAD_LOG_OPTS.maxLogMessageChars,
    editDebounceMs: v?.editDebounceMs ?? DEFAULT_THREAD_LOG_OPTS.editDebounceMs,
  };
}

async function resolveDiscordDestination(
  client: Client,
  discordUserId: string,
  chatId: string
): Promise<AnyTextChannel> {
  const state = await readDiscordState();
  const channelChatMap = state.channelChatMap || {};

  let targetDiscordChannelId: string | undefined;
  for (const [channelId, mappedChatId] of Object.entries(channelChatMap)) {
    if (mappedChatId?.chatId === chatId) {
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
    discordConfig?: DiscordConfig;
  } = {}
) {
  const defaultChatId = options.chatId ?? 'default';
  const signal = options.signal;
  const config = options.config ?? {};
  const threadLogOpts = resolveThreadLogOpts(options.discordConfig);
  const threadsGloballyEnabled = options.discordConfig?.visibility?.threads !== false;

  const activeSubscriptions = new Map<string, { unsubscribe: () => void }>();
  const activeTypingSubscriptions = new Map<string, { unsubscribe: () => void }>();
  let currentLastSyncedMessageIds = (await readDiscordState()).lastSyncedMessageIds || {};

  // Cache of opened activity-log threads by thread id so the buffer's
  // post/edit deps can locate the ThreadChannel without re-fetching on every
  // event.
  const threadsById = new Map<string, ThreadChannel>();

  const saveLastMessageId = async (chatId: string, id: string) => {
    currentLastSyncedMessageIds = { ...currentLastSyncedMessageIds, [chatId]: id };
    return updateDiscordState((state) => ({
      lastSyncedMessageIds: {
        ...state.lastSyncedMessageIds,
        ...currentLastSyncedMessageIds,
      },
    }));
  };

  const postThreaded = async (threadId: string, text: string): Promise<string | undefined> => {
    const thread = threadsById.get(threadId);
    if (!thread) {
      throw new Error(`Unknown thread id ${threadId} (no cached ThreadChannel).`);
    }
    const sent = await thread.send({ content: text || '​' });
    return sent.id;
  };

  const editThreaded = async (threadId: string, messageId: string, text: string): Promise<void> => {
    const thread = threadsById.get(threadId);
    if (!thread) {
      throw new Error(`Unknown thread id ${threadId} (no cached ThreadChannel).`);
    }
    const msg = await thread.messages.fetch(messageId);
    await msg.edit({ content: text || '​' });
  };

  const turnLog: TurnLogBuffer = createTurnLogBuffer({
    postThreaded,
    editThreaded,
    options: threadLogOpts,
    threadsEnabled: threadsGloballyEnabled,
  });

  const collapseDestination = (dest: Destination, turnId?: string): Destination => {
    // Both the global `visibility.threads: false` kill switch and the
    // per-channel `threadsDisabled` flag mean "quiet bot": drop thread-log
    // activity rather than promoting it top-level. Top-level spam is only
    // opt-in via `filters` (e.g. `/show`), matching pre-threaded behavior.
    if (dest.kind !== 'thread-log') return dest;
    if (!threadsGloballyEnabled) return { kind: 'drop' };
    if (turnId && turnLog.threadsDisabledFor(turnId)) return { kind: 'drop' };
    return dest;
  };

  const channelThreadsDisabled = async (chatId: string): Promise<boolean> => {
    const state = await readDiscordState();
    for (const [, entry] of Object.entries(state.channelChatMap || {})) {
      if (entry?.chatId === chatId) return entry.threadsDisabled === true;
    }
    return false;
  };

  const openThreadForTurn = async (
    externalRef: string | undefined
  ): Promise<string | undefined> => {
    if (!externalRef) return undefined;
    const inbound = resolveInbound(externalRef);
    if (!inbound) return undefined;
    let channel: AnyTextChannel | null;
    try {
      channel = (await client.channels.fetch(inbound.channelId)) as AnyTextChannel | null;
    } catch (err) {
      console.warn(`Failed to fetch channel ${inbound.channelId} for turn anchor:`, err);
      return undefined;
    }
    if (!channel || !channel.isTextBased() || channel.isDMBased() || channel.isThread()) {
      // DMs and existing threads can't host a new thread. Skip silently —
      // thread-log activity will accumulate then drop on turn end.
      return undefined;
    }
    const guildChannel = channel as TextChannel | NewsChannel;
    let userMessage: Message;
    try {
      userMessage = await guildChannel.messages.fetch(inbound.messageId);
    } catch (err) {
      console.warn(`Failed to fetch user message ${inbound.messageId} for turn anchor:`, err);
      return undefined;
    }
    try {
      const thread = await userMessage.startThread({
        name: 'Activity log',
        autoArchiveDuration: 60,
      });
      threadsById.set(thread.id, thread);
      return thread.id;
    } catch (err) {
      console.warn(`Failed to start thread on message ${inbound.messageId}:`, err);
      return undefined;
    }
  };

  const handleTurnStarted = async (
    chatId: string,
    turnId: string,
    _rootMessageId: string,
    externalRef?: string
  ) => {
    const threadsDisabled = await channelThreadsDisabled(chatId);
    let anchorThread: string | undefined;
    if (threadsGloballyEnabled && !threadsDisabled) {
      anchorThread = await openThreadForTurn(externalRef);
    }
    turnLog.start({ turnId, threadsDisabled, anchorThread });
  };

  const handleTurnEnded = async (turnId: string) => {
    const wasAnchored = turnLog.isAnchored(turnId);
    await turnLog.end(turnId);
    if (wasAnchored) {
      // The thread cache is keyed by thread id; we don't know which one to
      // free here without round-tripping through the buffer. Threads are
      // long-lived (Discord keeps them around archived) and the cache
      // bounds itself to the lifetime of the adapter process, so leaking
      // entries is acceptable in MVP.
    }
  };

  const sendPolicyCard = async (chatId: string, message: ChatMessage): Promise<boolean> => {
    if (message.role !== 'policy' || message.status !== 'pending') return false;
    try {
      const dm = await resolveDiscordDestination(client, discordUserId, chatId);

      const embed = new EmbedBuilder()
        .setTitle('Action Required: Policy Request')
        .setDescription(message.content || 'A pending policy request requires your attention.')
        .setColor(Colors.Yellow);

      const policyId = ('requestId' in message && message.requestId) || message.id;
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
          content: `Action Required: Policy Request\n\n${
            message.content || 'A pending policy request requires your attention.'
          }\n\nApprove: \`/approve ${policyId}\`\nReject: \`/reject ${policyId} <optional_rationale>\``,
        });
      }
    } catch (error) {
      console.error(`Failed to send message to Discord user ${discordUserId}:`, error);
    }
    return true;
  };

  const sendTopLevel = async (chatId: string, message: ChatMessage): Promise<void> => {
    if ('level' in message && (message as { level?: string }).level === 'verbose') return;

    const hasContent = !!message.content?.trim();
    const files = 'files' in message ? ((message as { files?: string[] }).files ?? []) : [];
    const hasFiles = Array.isArray(files) && files.length > 0;

    let absoluteFiles: string[] = [];
    if (hasFiles) {
      const workspaceRoot = getWorkspaceRoot(process.cwd());
      absoluteFiles = files.map((f) => path.resolve(workspaceRoot, f));
    }

    if (!hasContent && !hasFiles) return;

    try {
      const dm = await resolveDiscordDestination(client, discordUserId, chatId);
      const formattedContent = formatMessage(message);

      if (formattedContent && formattedContent.length > 2000) {
        const chunks = chunkString(formattedContent, 2000);
        for (let i = 0; i < chunks.length; i++) {
          if (signal?.aborted) break;
          const chunkOptions: MessageCreateOptions = { content: chunks[i] as string };
          if (i === chunks.length - 1 && hasFiles) {
            chunkOptions.files = absoluteFiles;
          }
          await dm.send(chunkOptions);
        }
      } else {
        const optionsMsg: MessageCreateOptions = {};
        if (formattedContent) optionsMsg.content = formattedContent;
        if (hasFiles) optionsMsg.files = absoluteFiles;
        await dm.send(optionsMsg);
      }
    } catch (error) {
      console.error(`Failed to send message to Discord user ${discordUserId}:`, error);
      throw error;
    }
  };

  const handleMessageForChat = async (chatId: string, message: ChatMessage): Promise<void> => {
    const routed = routeMessage(message, config);
    const effective = collapseDestination(routed, message.turnId);

    if (effective.kind === 'drop') return;

    if (effective.kind === 'thread-log') {
      if (!message.turnId) {
        console.warn(`thread-log event for ${message.role} has no turnId — dropping.`);
        return;
      }
      // No turn context: turnStarted may have been missed (adapter restart,
      // subscription reconnect). Drop silently rather than flooding the chat.
      if (!turnLog.has(message.turnId)) return;
      turnLog.append(message.turnId, message);
      return;
    }

    // Top-level.
    if (message.role === 'policy' && message.status === 'pending') {
      await sendPolicyCard(chatId, message);
      return;
    }

    await sendTopLevel(chatId, message);
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

    type StreamItem =
      | { kind: 'message'; message: ChatMessage }
      | {
          kind: 'turn';
          event:
            | { type: 'started'; turnId: string; rootMessageId: string; externalRef?: string }
            | { type: 'ended'; turnId: string; outcome: 'ok' | 'error' };
        };

    const connect = () => {
      if (signal?.aborted || !activeSubscriptions.has(chatId)) {
        return;
      }

      subscription = trpc.waitForMessages.subscribe(
        { chatId, lastMessageId },
        {
          onData: (items) => {
            retryDelay = 1000; // Reset retry delay on successful data

            if (!Array.isArray(items) || items.length === 0) {
              return;
            }

            messageQueue = messageQueue.then(async () => {
              for (const raw of items) {
                if (signal?.aborted || !activeSubscriptions.has(chatId)) break;

                const item = raw as StreamItem;
                if (item.kind === 'turn') {
                  if (item.event.type === 'started') {
                    await handleTurnStarted(
                      chatId,
                      item.event.turnId,
                      item.event.rootMessageId,
                      item.event.externalRef
                    );
                  } else {
                    await handleTurnEnded(item.event.turnId);
                  }
                  continue;
                }

                const message = item.message;
                try {
                  await handleMessageForChat(chatId, message);
                } catch (err) {
                  console.error('Failed to handle message:', err);
                  // Don't advance lastMessageId on a hard error so we retry on
                  // reconnect; matches prior behavior.
                  break;
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
            typingRetryDelay = 1000;
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
      for (const mappedEntry of Object.values(state.channelChatMap)) {
        if (mappedEntry.chatId) {
          targetChatIds.add(mappedEntry.chatId);
        }
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
    let debounceTimer: NodeJS.Timeout | null = null;
    const watcher = fs.watch(stateDir, (eventType: string, filename: string | null) => {
      if (filename === path.basename(statePath)) {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          syncSubscriptions().catch(console.error);
        }, 200);
      }
    });

    signal?.addEventListener('abort', () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      watcher.close();
      for (const sub of activeSubscriptions.values()) sub.unsubscribe();
      for (const sub of activeTypingSubscriptions.values()) sub.unsubscribe();
      turnLog.shutdown();
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
