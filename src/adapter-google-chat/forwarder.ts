/* eslint-disable max-lines */
import { google } from 'googleapis';
import { getAuthClient } from './auth.js';
import type { getTRPCClient, GoogleChatApi } from './client.js';
import type { ChatMessage } from '../shared/chats.js';
import path from 'node:path';
import fs from 'node:fs';
import type { GoogleChatConfig } from './config.js';
import {
  readGoogleChatState,
  updateGoogleChatState,
  getGoogleChatStatePath,
  resolveInboundByGchatMessageName,
} from './state.js';
import {
  routeMessage,
  formatMessage,
  type Destination,
  type FilteringConfig,
} from '../shared/adapters/filtering.js';
import {
  formatTurnLogEntry,
  condenseTurnLog,
  type TurnLogEntry,
  type CondenseStrategy,
} from '../shared/adapters/turn-log.js';
import { buildPolicyCard, chunkString } from './utils.js';
import { uploadFilesToDrive } from './upload.js';

export interface GoogleChatForwarderDeps {
  /** Google Chat API client (defaults to `google.chat()` with ADC credentials). */
  chatApi?: GoogleChatApi;
  /** Root directory for resolving adapter state (defaults to `process.cwd()`). */
  startDir?: string;
}

interface ThreadLogOptions {
  maxToolPreview: number;
  maxLogMessageChars: number;
  editDebounceMs: number;
  condenseStrategy: CondenseStrategy;
}

interface TurnContext {
  turnId: string;
  chatId: string;
  spaceName: string;
  rootDaemonMessageId: string;
  rootGchatMessageName: string | undefined;
  gchatThreadName: string | undefined;
  activityLogMessageName: string | undefined;
  entries: TurnLogEntry[];
  editTimer: NodeJS.Timeout | undefined;
  degraded: boolean;
  threadsDisabled: boolean;
}

const DEFAULT_THREAD_LOG_OPTS: ThreadLogOptions = {
  maxToolPreview: 400,
  maxLogMessageChars: 3500,
  editDebounceMs: 1000,
  condenseStrategy: 'rollover',
};

/**
 * Upper bound on the number of `TurnContext` entries held in memory. Async
 * subagents can outlive their parent turn by minutes, so we keep turn
 * contexts around past `turnEnded` — late activity still needs somewhere to
 * land. The LRU cap bounds memory for long-running daemons.
 */
const MAX_TURN_CONTEXTS = 64;

function resolveThreadLogOpts(config: GoogleChatConfig): ThreadLogOptions {
  const v = config.visibility?.threadLog;
  return {
    maxToolPreview: v?.maxToolPreview ?? DEFAULT_THREAD_LOG_OPTS.maxToolPreview,
    maxLogMessageChars: v?.maxLogMessageChars ?? DEFAULT_THREAD_LOG_OPTS.maxLogMessageChars,
    editDebounceMs: v?.editDebounceMs ?? DEFAULT_THREAD_LOG_OPTS.editDebounceMs,
    condenseStrategy: v?.condenseStrategy ?? DEFAULT_THREAD_LOG_OPTS.condenseStrategy,
  };
}

async function resolveSpaceForChat(
  chatId: string,
  startDir: string
): Promise<{ spaceName: string; threadsDisabled: boolean } | null> {
  const state = await readGoogleChatState(startDir);
  const entry = Object.entries(state.channelChatMap || {}).find(([, v]) => v?.chatId === chatId);
  if (!entry) return null;
  const [spaceName, mapping] = entry;
  return {
    spaceName,
    threadsDisabled: mapping.threadsDisabled === true,
  };
}

export async function startDaemonToGoogleChatForwarder(
  trpc: ReturnType<typeof getTRPCClient>,
  config: GoogleChatConfig,
  filteringConfig: FilteringConfig,
  signal?: AbortSignal,
  deps: GoogleChatForwarderDeps = {}
) {
  const defaultChatId = config.chatId || 'default';
  const startDir = deps.startDir ?? process.cwd();
  const threadLogOpts = resolveThreadLogOpts(config);
  const threadsGloballyEnabled = config.visibility?.threads !== false;

  const getChatApi = async (): Promise<GoogleChatApi> => {
    if (deps.chatApi) return deps.chatApi;
    const authClient = await getAuthClient();
    return google.chat({ version: 'v1', auth: authClient });
  };

  const activeSubscriptions = new Map<
    string,
    { unsubscribe: () => void; turnSub?: { unsubscribe: () => void } }
  >();
  const turnContexts = new Map<string, TurnContext>();
  let currentLastSyncedMessageIds =
    (await readGoogleChatState(startDir)).lastSyncedMessageIds || {};

  const saveLastMessageId = async (chatId: string, id: string) => {
    currentLastSyncedMessageIds = { ...currentLastSyncedMessageIds, [chatId]: id };
    return updateGoogleChatState(
      (state) => ({
        lastSyncedMessageIds: {
          ...state.lastSyncedMessageIds,
          ...currentLastSyncedMessageIds,
        },
      }),
      startDir
    );
  };

  const postTopLevel = async (
    spaceName: string,
    text: string,
    cardsV2?: ReturnType<typeof buildPolicyCard>
  ): Promise<void> => {
    const chatApi = await getChatApi();
    if (cardsV2 && cardsV2.length > 0) {
      await chatApi.spaces.messages.create({
        parent: spaceName,
        requestBody: { text: text || '', cardsV2 },
      });
      return;
    }
    if (text.length > 4000) {
      const chunks = chunkString(text, 4000);
      for (const chunk of chunks) {
        await chatApi.spaces.messages.create({
          parent: spaceName,
          requestBody: { text: chunk },
        });
      }
      return;
    }
    await chatApi.spaces.messages.create({
      parent: spaceName,
      requestBody: { text },
    });
  };

  const postThreaded = async (
    spaceName: string,
    threadName: string,
    text: string,
    cardsV2?: ReturnType<typeof buildPolicyCard>
  ): Promise<string | undefined> => {
    const chatApi = await getChatApi();
    const res = await chatApi.spaces.messages.create({
      parent: spaceName,
      requestBody: {
        text: text || '',
        thread: { name: threadName },
        ...(cardsV2 && cardsV2.length > 0 ? { cardsV2 } : {}),
      },
      messageReplyOption: 'REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD',
    });
    const data = (res as { data?: { name?: string } }).data ?? (res as { name?: string });
    return data?.name ?? undefined;
  };

  const editThreaded = async (messageName: string, text: string): Promise<void> => {
    const chatApi = await getChatApi();
    await chatApi.spaces.messages.update({
      name: messageName,
      updateMask: 'text',
      requestBody: { text },
    });
  };

  const handlePolicyCard = async (
    message: Extract<ChatMessage, { role: 'policy' }>,
    spaceName: string,
    threadName?: string
  ) => {
    const cards = buildPolicyCard(message);
    try {
      if (threadName) {
        await postThreaded(spaceName, threadName, '', cards);
      } else {
        await postTopLevel(spaceName, '', cards);
      }
    } catch (richError) {
      console.warn(
        'Failed to send rich policy request to Google Chat, falling back to plain text:',
        richError
      );
      const policyId = ('requestId' in message && message.requestId) || message.id;
      const text = `Action Required: Policy Request\n\n${
        message.content || 'A pending policy request requires your attention.'
      }\n\nApprove: \`/approve ${policyId}\`\nReject: \`/reject ${policyId} <optional_rationale>\``;
      if (threadName) {
        await postThreaded(spaceName, threadName, text);
      } else {
        await postTopLevel(spaceName, text);
      }
    }
  };

  const flushTurnLog = async (ctx: TurnContext): Promise<void> => {
    if (ctx.editTimer) {
      clearTimeout(ctx.editTimer);
      ctx.editTimer = undefined;
    }
    if (ctx.entries.length === 0) return;
    if (!ctx.spaceName || !ctx.gchatThreadName) return;
    if (ctx.degraded) return;

    let result = condenseTurnLog(ctx.entries, {
      maxChars: threadLogOpts.maxLogMessageChars,
      strategy: threadLogOpts.condenseStrategy,
    });

    const send = async (): Promise<void> => {
      if (!ctx.activityLogMessageName) {
        const text = result.kind === 'fits' ? result.text : result.finalText;
        try {
          const name = await postThreaded(ctx.spaceName, ctx.gchatThreadName!, text);
          if (name) ctx.activityLogMessageName = name;
        } catch (err) {
          console.error('Failed to open thread-log message, falling back to top-level:', err);
          ctx.degraded = true;
          try {
            await postTopLevel(ctx.spaceName, text);
          } catch (innerErr) {
            console.error('Top-level fallback also failed:', innerErr);
          }
          ctx.entries = [];
          return;
        }
      } else {
        const text = result.kind === 'fits' ? result.text : result.finalText;
        try {
          await editThreaded(ctx.activityLogMessageName, text);
        } catch (err) {
          const status = (err as { code?: number; status?: number })?.code ?? 0;
          if (status === 404) {
            console.warn('Log message 404 on edit — opening a fresh log message.');
            ctx.activityLogMessageName = undefined;
            try {
              const name = await postThreaded(ctx.spaceName, ctx.gchatThreadName!, text);
              if (name) ctx.activityLogMessageName = name;
            } catch (innerErr) {
              console.error('Failed to re-open log message after 404:', innerErr);
              ctx.activityLogMessageName = undefined;
            }
          } else {
            await new Promise((resolve) => setTimeout(resolve, 500));
            try {
              await editThreaded(ctx.activityLogMessageName, text);
            } catch (retryErr) {
              console.warn('Edit failed twice — finalizing log message.', retryErr);
              ctx.activityLogMessageName = undefined;
            }
          }
        }
      }
    };

    await send();

    // On rollover, the finalized message is sealed; the carry-over entries
    // seed a brand-new activity-log message. Otherwise keep `entries` intact
    // so the next debounced edit re-renders the full history plus new events,
    // rather than overwriting the message with only the latest entry.
    if (result.kind === 'rollover') {
      ctx.entries = result.carryEntries.slice();
      ctx.activityLogMessageName = undefined;
      if (ctx.entries.length > 0) {
        result = condenseTurnLog(ctx.entries, {
          maxChars: threadLogOpts.maxLogMessageChars,
          strategy: threadLogOpts.condenseStrategy,
        });
        await send();
      }
    }
  };

  const scheduleFlush = (ctx: TurnContext) => {
    if (ctx.editTimer) return;
    ctx.editTimer = setTimeout(() => {
      ctx.editTimer = undefined;
      flushTurnLog(ctx).catch((err) => console.error('Flush error:', err));
    }, threadLogOpts.editDebounceMs);
  };

  const collapseDestination = (dest: Destination, ctx?: TurnContext | null): Destination => {
    if (!threadsGloballyEnabled) {
      if (dest.kind === 'thread-log') return { kind: 'drop' };
      if (dest.kind === 'thread-message') return { kind: 'top-level' };
    }
    if (ctx?.threadsDisabled) {
      if (dest.kind === 'thread-log') return { kind: 'top-level' };
      if (dest.kind === 'thread-message') return { kind: 'top-level' };
    }
    return dest;
  };

  const handleMessageForChat = async (chatId: string, message: ChatMessage) => {
    const routed = routeMessage(message, filteringConfig);
    const ctx = message.turnId ? turnContexts.get(message.turnId) : null;

    const effective = collapseDestination(routed, ctx);

    if (effective.kind === 'drop') return;

    const space = await resolveSpaceForChat(chatId, startDir);
    if (!space) {
      console.warn('No active Google Chat space to reply to. Ignoring message:', message.content);
      return;
    }

    // Verbose-level legacy messages still drop silently.
    if ('level' in message && (message as { level?: string }).level === 'verbose') return;

    const hasContent = !!message.content?.trim();
    const files = 'files' in message ? ((message as { files?: string[] }).files ?? []) : [];
    const hasFiles = files.length > 0;

    if (effective.kind === 'thread-message') {
      if (message.role === 'policy' && message.status === 'pending') {
        await handlePolicyCard(message, space.spaceName, ctx?.gchatThreadName);
      }
      return;
    }

    if (effective.kind === 'thread-log') {
      if (!ctx?.gchatThreadName) {
        // No turn context (turn events may have been missed, adapter restart,
        // or subagent-sourced message without propagated turnId). Drop silently
        // rather than flooding the space with orphan top-level messages.
        if (!message.turnId) {
          console.warn(`thread-log event for ${message.role} has no turnId — dropping.`);
        }
        return;
      }
      const entry = formatTurnLogEntry(message, {
        maxToolPreview: threadLogOpts.maxToolPreview,
      });
      if (!entry) return;
      ctx.entries.push(entry);
      scheduleFlush(ctx);
      return;
    }

    // Top-level: existing behavior.
    if (!hasContent && !hasFiles && message.role !== 'policy') return;

    try {
      if (message.role === 'policy' && message.status === 'pending') {
        await handlePolicyCard(message, space.spaceName);
        return;
      }

      let text = formatMessage(message) || '';

      if (hasFiles) {
        const fileNames = files.map((f: string) => path.basename(f)).join(', ');
        if (
          config.driveUploadEnabled !== false &&
          config.oauthClientId &&
          config.oauthClientSecret
        ) {
          text += `\n\n`;
          try {
            const uploadResults = await uploadFilesToDrive(files, config);
            for (const result of uploadResults) {
              text += `${result}\n`;
            }
          } catch (driveAuthErr) {
            console.error('Drive API/Auth Failed, degrading to local files output:', driveAuthErr);
            text += `*(Files generated: ${fileNames})*`;
          }
        } else {
          text += `\n\n*(Files generated: ${fileNames})*`;
        }
      }

      await postTopLevel(space.spaceName, text);
    } catch (err) {
      console.error('Failed to send message to Google Chat:', err);
    }
  };

  const evictOldestTurnContextIfFull = () => {
    while (turnContexts.size >= MAX_TURN_CONTEXTS) {
      const oldest = turnContexts.keys().next().value;
      if (!oldest) return;
      const ctx = turnContexts.get(oldest);
      if (ctx?.editTimer) clearTimeout(ctx.editTimer);
      turnContexts.delete(oldest);
    }
  };

  const handleTurnStarted = async (
    chatId: string,
    turnId: string,
    rootMessageId: string,
    externalRef?: string
  ) => {
    const space = await resolveSpaceForChat(chatId, startDir);
    if (!space) {
      console.warn(`turnStarted for chat ${chatId} with no mapped space.`);
      return;
    }

    // The adapter sent `externalRef` as the GChat message.name of the inbound
    // that triggered this turn, so we look up the thread anchor directly
    // rather than guessing via FIFO pairing. Turns with no externalRef
    // (proactive crons, CLI messages) get no thread anchor and thread-log
    // events are dropped.
    const entry = externalRef
      ? await resolveInboundByGchatMessageName(space.spaceName, externalRef, startDir)
      : null;

    evictOldestTurnContextIfFull();

    const ctx: TurnContext = {
      turnId,
      chatId,
      spaceName: space.spaceName,
      rootDaemonMessageId: rootMessageId,
      rootGchatMessageName: entry?.gchatMessageName,
      gchatThreadName: entry?.gchatThreadName,
      activityLogMessageName: undefined,
      entries: [],
      editTimer: undefined,
      degraded: false,
      threadsDisabled: space.threadsDisabled,
    };
    turnContexts.set(turnId, ctx);
  };

  const handleTurnEnded = async (turnId: string) => {
    const ctx = turnContexts.get(turnId);
    if (!ctx) return;
    // Keep the context in the map: async subagents can emit thread-log
    // events long after the parent's turn ends, and they need to land in
    // the same log message. Just flush any debounced edits so the on-screen
    // state matches what's buffered. LRU eviction bounds memory.
    await flushTurnLog(ctx).catch((err) => console.error('Final flush error:', err));
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
      `Starting daemon-to-google-chat forwarder for chat ${chatId}, lastMessageId: ${lastMessageId}`
    );

    let retryDelay = 1000;
    const maxRetryDelay = 30000;

    let subscription: { unsubscribe: () => void } | null = null;
    let turnSubscription: { unsubscribe: () => void } | null = null;
    let messageQueue = Promise.resolve();

    const connect = () => {
      if (signal?.aborted || !activeSubscriptions.has(chatId)) return;

      subscription = trpc.waitForMessages.subscribe(
        { chatId, lastMessageId },
        {
          onData: (messages) => {
            retryDelay = 1000;
            if (!Array.isArray(messages) || messages.length === 0) return;

            messageQueue = messageQueue
              .then(async () => {
                for (const rawMessage of messages) {
                  if (signal?.aborted || !activeSubscriptions.has(chatId)) break;
                  const message = rawMessage as ChatMessage;
                  await handleMessageForChat(chatId, message);
                  await saveLastMessageId(chatId, message.id).catch(console.error);
                  lastMessageId = message.id;
                }
              })
              .catch((error) => {
                console.error('Message queue failed, forcing reconnect...', error);
                subscription?.unsubscribe();
                subscription = null;
                if (signal?.aborted || !activeSubscriptions.has(chatId)) return;
                setTimeout(() => {
                  retryDelay = Math.min(retryDelay * 2, maxRetryDelay);
                  connect();
                }, retryDelay);
              });
          },
          onError: (error) => {
            console.error(
              `Error in daemon-to-google-chat forwarder subscription for ${chatId}. Retrying in ${retryDelay}ms.`,
              error
            );
            subscription?.unsubscribe();
            subscription = null;
            if (signal?.aborted || !activeSubscriptions.has(chatId)) return;
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

      turnSubscription = trpc.waitForTurns.subscribe(
        { chatId },
        {
          onData: (event: unknown) => {
            const e = event as
              | {
                  type: 'started';
                  turnId: string;
                  rootMessageId: string;
                  externalRef?: string;
                }
              | { type: 'ended'; turnId: string; outcome: 'ok' | 'error' };
            if (!e) return;
            messageQueue = messageQueue
              .then(async () => {
                if (e.type === 'started') {
                  await handleTurnStarted(chatId, e.turnId, e.rootMessageId, e.externalRef);
                } else {
                  await handleTurnEnded(e.turnId);
                }
              })
              .catch((err) => console.error('Turn handler failed:', err));
          },
          onError: (err) => {
            console.error(`waitForTurns subscription error for ${chatId}:`, err);
          },
          onComplete: () => {
            turnSubscription = null;
          },
        }
      );
    };

    activeSubscriptions.set(chatId, {
      unsubscribe: () => {
        subscription?.unsubscribe();
        turnSubscription?.unsubscribe();
      },
    });

    connect();
  };

  const syncSubscriptions = async () => {
    if (signal?.aborted) return;
    const state = await readGoogleChatState(startDir);

    if (state.lastSyncedMessageIds) {
      currentLastSyncedMessageIds = {
        ...state.lastSyncedMessageIds,
        ...currentLastSyncedMessageIds,
      };
    }

    const targetChatIds = new Set<string>();
    targetChatIds.add(defaultChatId);

    if (state.channelChatMap) {
      for (const mappedEntry of Object.values(state.channelChatMap)) {
        if (mappedEntry.chatId) targetChatIds.add(mappedEntry.chatId);
      }
    }

    for (const targetChatId of targetChatIds) {
      if (!activeSubscriptions.has(targetChatId)) {
        startSubscriptionForChat(targetChatId);
      }
    }

    for (const [activeChatId, sub] of activeSubscriptions.entries()) {
      if (!targetChatIds.has(activeChatId)) {
        sub.unsubscribe();
        activeSubscriptions.delete(activeChatId);
      }
    }
  };

  return new Promise<void>((resolve) => {
    syncSubscriptions().catch(console.error);

    const statePath = getGoogleChatStatePath(startDir);
    const stateDir = path.dirname(statePath);
    if (!fs.existsSync(stateDir)) {
      fs.mkdirSync(stateDir, { recursive: true });
    }
    let debounceTimer: NodeJS.Timeout | null = null;
    const watcher = fs.watch(stateDir, (_eventType, filename) => {
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
      for (const ctx of turnContexts.values()) {
        if (ctx.editTimer) clearTimeout(ctx.editTimer);
      }
      turnContexts.clear();
      resolve();
    });
  });
}
