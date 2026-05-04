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
import { createTurnLogBuffer, type TurnLogBuffer } from '../shared/adapters/turn-log-buffer.js';
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

// Suppresses every form of mention (@everyone, @here, role, user) on bot
// posts. Tool payloads, agent output, and policy descriptions can contain
// arbitrary text; without this, an `@everyone` substring in (e.g.) a shell
// command echoed into the activity log would page the entire channel.
const NO_MENTIONS = { allowedMentions: { parse: [] as [] } } as const;

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
  const jobsMode: 'silent' | 'header' = options.discordConfig?.visibility?.jobs ?? 'silent';

  const activeSubscriptions = new Map<string, { unsubscribe: () => void }>();
  const activeTypingSubscriptions = new Map<string, { unsubscribe: () => void }>();
  /**
   * When a proactive turn (cron in 'header' mode) posts a top-level header
   * before its `turnStarted` event arrives, we cache the resulting thread by
   * the daemon message id (= the future turn's rootMessageId). `handleTurn-
   * Started` then anchors the buffer on it. LRU-bounded so a daemon that
   * spews crons can't grow this map indefinitely.
   */
  const proactiveAnchors = new Map<string, ThreadChannel>();
  const MAX_PROACTIVE_ANCHORS = 64;
  const recordProactiveAnchor = (daemonMessageId: string, thread: ThreadChannel) => {
    while (proactiveAnchors.size >= MAX_PROACTIVE_ANCHORS) {
      const oldest = proactiveAnchors.keys().next().value;
      if (!oldest) break;
      proactiveAnchors.delete(oldest);
    }
    proactiveAnchors.set(daemonMessageId, thread);
  };
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

  const postThreaded = async (anchor: ThreadChannel, text: string): Promise<string | undefined> => {
    const sent = await anchor.send({ content: text || '​', ...NO_MENTIONS });
    return sent.id;
  };

  const editThreaded = async (
    anchor: ThreadChannel,
    messageId: string,
    text: string
  ): Promise<void> => {
    // Use MessageManager#edit(id, options) instead of fetch+edit so each edit
    // is a single REST call. Doubling per-edit traffic was the main driver of
    // hitting Discord's 5-edits-per-5-sec channel rate limit on busy turns.
    await anchor.messages.edit(messageId, { content: text || '​', ...NO_MENTIONS });
  };

  // Discord returns 10008 (Unknown Message) when an activity-log message has
  // been deleted by the user; Cloudflare/HTTP layers may surface a generic
  // 404. Either case means the same thing: open a fresh log message.
  const isMissingMessageError = (err: unknown): boolean => {
    const code = (err as { code?: number; status?: number })?.code ?? 0;
    return code === 404 || code === 10008;
  };

  const turnLog: TurnLogBuffer<ThreadChannel> = createTurnLogBuffer<ThreadChannel>({
    postThreaded,
    editThreaded,
    isMissingMessageError,
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
  ): Promise<ThreadChannel | undefined> => {
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
      // proactive turns and DM-only flows simply have no activity log.
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
    // Discord allows only one thread per message. The same inbound can anchor
    // multiple turns (e.g. a follow-up turn fanned out from the original
    // request), so reuse an existing thread rather than failing the second
    // turn's activity log.
    if (userMessage.hasThread && userMessage.thread) {
      return userMessage.thread as ThreadChannel;
    }
    try {
      return await userMessage.startThread({
        name: 'Activity log',
        // 1 day. Long agent runs (refactors, builds) outlive the previous
        // 60-minute archive window and end up posting into archived threads
        // that fall off the channel sidebar.
        autoArchiveDuration: 1440,
      });
    } catch (err) {
      // Race: another turn for the same inbound created the thread between
      // our `hasThread` check and `startThread`. Discord returns 160004
      // (THREAD_ALREADY_CREATED_FOR_MESSAGE). Re-fetch and reuse.
      const code = (err as { code?: number })?.code;
      if (code === 160004) {
        try {
          const refreshed = await guildChannel.messages.fetch(inbound.messageId);
          if (refreshed.hasThread && refreshed.thread) {
            return refreshed.thread as ThreadChannel;
          }
        } catch (refetchErr) {
          console.warn(
            `Failed to refetch user message ${inbound.messageId} after thread-exists race:`,
            refetchErr
          );
        }
      }
      console.warn(`Failed to start thread on message ${inbound.messageId}:`, err);
      return undefined;
    }
  };

  const handleTurnStarted = async (
    chatId: string,
    turnId: string,
    rootMessageId: string,
    externalRef?: string
  ) => {
    // Single source of truth for "is the activity log on for this turn":
    // global kill switch OR per-channel opt-out. The buffer's `engaged()`
    // and `collapseDestination`'s `threadsDisabledFor()` both consult the
    // ctx flag set here, so we don't have to re-derive it later.
    const threadsDisabled = !threadsGloballyEnabled || (await channelThreadsDisabled(chatId));
    let anchor: ThreadChannel | undefined;
    if (!threadsDisabled) {
      // Skip the API roundtrip when we already know the log is off.
      anchor = await openThreadForTurn(externalRef);
      if (!anchor) {
        // Proactive turn (no inbound externalRef, or DM/race). If the cron
        // header for this turn already landed, its thread is cached by
        // rootMessageId — pick it up.
        const cached = proactiveAnchors.get(rootMessageId);
        if (cached) {
          proactiveAnchors.delete(rootMessageId);
          anchor = cached;
        }
      }
    }
    // Always start the buffer, even unanchored. Subsequent events can supply
    // the anchor via `assignAnchor`: a cron header in 'header' mode, or the
    // turn's first top-level post (the agent's reply, a policy-card-less
    // /approve feedback turn, etc.) opening a thread on itself. If no anchor
    // ever arrives the buffer's entries are dropped silently on `end`.
    turnLog.start({ turnId, threadsDisabled, anchorThread: anchor });
  };

  const handleTurnEnded = async (turnId: string) => {
    await turnLog.end(turnId);
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
        ...NO_MENTIONS,
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
          ...NO_MENTIONS,
        });
      }
    } catch (error) {
      console.error(`Failed to send message to Discord user ${discordUserId}:`, error);
    }
    return true;
  };

  /**
   * Open an Activity-log thread on a top-level message and wire it to the
   * turn-log buffer. Used both by `postCronHeader` (where the cron message
   * arrives before `turnStarted` and the anchor is cached by rootMessageId)
   * and by `sendTopLevel` (where `turnStarted` has already landed and the
   * buffer is waiting unanchored). DMs, threads, and disabled channels are
   * no-ops — the message still lands but no activity log is attached.
   */
  const wireAnchorFromMessage = async (
    chatId: string,
    sent: Message,
    dest: AnyTextChannel,
    message: ChatMessage
  ): Promise<void> => {
    if (dest.isDMBased() || dest.isThread()) return;
    if (!threadsGloballyEnabled || (await channelThreadsDisabled(chatId))) return;

    let thread: ThreadChannel;
    try {
      thread = await sent.startThread({ name: 'Activity log', autoArchiveDuration: 1440 });
    } catch (err) {
      console.warn('Failed to start activity-log thread on top-level message:', err);
      return;
    }

    if (message.turnId && turnLog.has(message.turnId)) {
      if (!turnLog.isAnchored(message.turnId)) {
        turnLog.assignAnchor(message.turnId, thread);
      }
    } else {
      // Cron-header race: the cron message arrives before `turnStarted`, so
      // the buffer doesn't exist yet. Stash by daemon message id (which the
      // daemon emits as the future turn's `rootMessageId`) for
      // `handleTurnStarted` to pick up.
      recordProactiveAnchor(message.id, thread);
    }
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

    let dest: AnyTextChannel | undefined;
    let firstSent: Message | undefined;
    try {
      dest = await resolveDiscordDestination(client, discordUserId, chatId);
      const formattedContent = formatMessage(message);

      if (formattedContent && formattedContent.length > 2000) {
        const chunks = chunkString(formattedContent, 2000);
        for (let i = 0; i < chunks.length; i++) {
          if (signal?.aborted) break;
          const chunkOptions: MessageCreateOptions = {
            content: chunks[i] as string,
            ...NO_MENTIONS,
          };
          if (i === chunks.length - 1 && hasFiles) {
            chunkOptions.files = absoluteFiles;
          }
          const sent = (await dest.send(chunkOptions)) as Message;
          if (i === 0) firstSent = sent;
        }
      } else {
        const optionsMsg: MessageCreateOptions = { ...NO_MENTIONS };
        if (formattedContent) optionsMsg.content = formattedContent;
        if (hasFiles) optionsMsg.files = absoluteFiles;
        firstSent = (await dest.send(optionsMsg)) as Message;
      }
    } catch (error) {
      console.error(`Failed to send message to Discord user ${discordUserId}:`, error);
      throw error;
    }

    // If this top-level post belongs to a turn whose activity-log buffer is
    // still waiting for an anchor (proactive cron in 'silent' mode, agent
    // reply on a /approve turn typed as a slash command, subagent runs, etc),
    // open the Activity-log thread on the first chunk and flush. Skipped
    // when the turn is already anchored, when the destination can't host a
    // thread (DM/thread), or when threads are disabled.
    if (
      firstSent &&
      dest &&
      message.turnId &&
      turnLog.has(message.turnId) &&
      !turnLog.isAnchored(message.turnId)
    ) {
      await wireAnchorFromMessage(chatId, firstSent, dest, message);
    }
  };

  const postCronHeader = async (chatId: string, message: ChatMessage): Promise<void> => {
    if (message.role !== 'system' || message.event !== 'cron') return;
    const label = message.jobId ?? 'scheduled';
    const text = `🕐 ${label}`;
    let dest: AnyTextChannel;
    try {
      dest = await resolveDiscordDestination(client, discordUserId, chatId);
    } catch (err) {
      console.warn(`Failed to resolve destination for cron header (chat ${chatId}):`, err);
      return;
    }
    let sent: Message;
    try {
      sent = (await dest.send({ content: text, ...NO_MENTIONS })) as Message;
    } catch (err) {
      console.warn(`Failed to post cron header for chat ${chatId}:`, err);
      return;
    }
    await wireAnchorFromMessage(chatId, sent, dest, message);
  };

  const handleMessageForChat = async (chatId: string, message: ChatMessage): Promise<void> => {
    const routed = routeMessage(message, config);

    // 'header' mode: cron system messages route to drop by default; promote
    // them to a terse top-level header so the user can see scheduled work
    // even when the agent stays silent. The header doubles as the thread
    // anchor for the resulting turn's activity log.
    const isCronHeader =
      jobsMode === 'header' && message.role === 'system' && message.event === 'cron';

    if (isCronHeader) {
      await postCronHeader(chatId, message);
      return;
    }

    const effective = collapseDestination(routed, message.turnId);

    if (effective.kind === 'drop') return;

    if (effective.kind === 'thread-log') {
      if (!message.turnId) {
        console.warn(`thread-log event for ${message.role} has no turnId — dropping.`);
        return;
      }
      // No turn context: turnStarted may have been missed (adapter restart,
      // subscription reconnect) or the turn had no anchor (proactive / DM).
      // Drop silently rather than flooding the chat.
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

            messageQueue = messageQueue
              .then(async () => {
                for (const raw of items) {
                  if (signal?.aborted || !activeSubscriptions.has(chatId)) break;

                  const item = raw as StreamItem;
                  if (item.kind === 'turn') {
                    // Turn events do disk reads (state.json) and Discord API
                    // fetches; either can throw transiently. Catch here so a
                    // single bad event doesn't reject the .then and poison
                    // the chain — every subsequent batch would silently no-op.
                    try {
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
                    } catch (err) {
                      console.error('Failed to handle turn event:', err);
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
              })
              // Belt-and-suspenders: anything that escapes the per-item
              // try/catches above (sync throw before the loop, etc.) must
              // not leave the chain in a rejected state.
              .catch((err) => console.error('Message queue chain error:', err));
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
