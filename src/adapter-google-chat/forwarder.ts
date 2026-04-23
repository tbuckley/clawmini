/* eslint-disable max-lines */
import { google } from 'googleapis';
import { getAuthClient } from './auth.js';
import type { getTRPCClient, GoogleChatApi } from './client.js';
import type { ChatMessage } from '../shared/chats.js';
import path from 'node:path';
import fs from 'node:fs';
import type { GoogleChatConfig } from './config.js';
import { readGoogleChatState, updateGoogleChatState, getGoogleChatStatePath } from './state.js';
import { resolveInbound } from './inbound-cache.js';
import {
  routeMessage,
  formatMessage,
  type Destination,
  type FilteringConfig,
} from '../shared/adapters/filtering.js';
import { createTurnLogBuffer, type TurnLogBuffer } from './turn-log-buffer.js';
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
}

const DEFAULT_THREAD_LOG_OPTS: ThreadLogOptions = {
  maxToolPreview: 400,
  maxLogMessageChars: 3500,
  editDebounceMs: 1000,
};

function resolveThreadLogOpts(config: GoogleChatConfig): ThreadLogOptions {
  const v = config.visibility?.threadLog;
  return {
    maxToolPreview: v?.maxToolPreview ?? DEFAULT_THREAD_LOG_OPTS.maxToolPreview,
    maxLogMessageChars: v?.maxLogMessageChars ?? DEFAULT_THREAD_LOG_OPTS.maxLogMessageChars,
    editDebounceMs: v?.editDebounceMs ?? DEFAULT_THREAD_LOG_OPTS.editDebounceMs,
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
  const jobsMode: 'silent' | 'header' = config.visibility?.jobs ?? 'silent';

  const getChatApi = async (): Promise<GoogleChatApi> => {
    if (deps.chatApi) return deps.chatApi;
    const authClient = await getAuthClient();
    return google.chat({ version: 'v1', auth: authClient });
  };

  const activeSubscriptions = new Map<string, { unsubscribe: () => void }>();
  /**
   * When a turn has no inbound-user anchor (cron, subagent completion, any
   * proactive turn), its first top-level post implicitly creates a GChat
   * thread. Record `daemonMessageId -> gchatThreadName` here so a late
   * `turnStarted` event can still resolve the anchor. LRU-bounded to keep
   * memory predictable on long-running daemons.
   */
  const proactiveAnchors = new Map<string, string>();
  const MAX_PROACTIVE_ANCHORS = 64;
  const recordProactiveAnchor = (daemonMessageId: string, threadName: string) => {
    while (proactiveAnchors.size >= MAX_PROACTIVE_ANCHORS) {
      const oldest = proactiveAnchors.keys().next().value;
      if (!oldest) break;
      proactiveAnchors.delete(oldest);
    }
    proactiveAnchors.set(daemonMessageId, threadName);
  };
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

  /**
   * Post a top-level message (no `thread` field; GChat auto-creates a fresh
   * thread). Returns the newly-created thread's `name` so callers can anchor
   * subsequent threaded replies on it — used to thread activity under
   * proactive turns (cron, subagent_update) that have no inbound user
   * message to anchor on.
   */
  const postTopLevel = async (
    spaceName: string,
    text: string,
    cardsV2?: ReturnType<typeof buildPolicyCard>
  ): Promise<{ threadName: string | undefined }> => {
    const chatApi = await getChatApi();
    const extractThread = (res: unknown): string | undefined => {
      const data =
        (res as { data?: { thread?: { name?: string } } }).data ??
        (res as { thread?: { name?: string } });
      return data?.thread?.name ?? undefined;
    };
    if (cardsV2 && cardsV2.length > 0) {
      const res = await chatApi.spaces.messages.create({
        parent: spaceName,
        requestBody: { text: text || '', cardsV2 },
      });
      return { threadName: extractThread(res) };
    }
    if (text.length > 4000) {
      const chunks = chunkString(text, 4000);
      let firstThread: string | undefined;
      for (const chunk of chunks) {
        const res = await chatApi.spaces.messages.create({
          parent: spaceName,
          requestBody: { text: chunk },
        });
        firstThread ??= extractThread(res);
      }
      return { threadName: firstThread };
    }
    const res = await chatApi.spaces.messages.create({
      parent: spaceName,
      requestBody: { text },
    });
    return { threadName: extractThread(res) };
  };

  const postThreaded = async (
    spaceName: string,
    threadName: string,
    text: string
  ): Promise<string | undefined> => {
    const chatApi = await getChatApi();
    const res = await chatApi.spaces.messages.create({
      parent: spaceName,
      requestBody: {
        text: text || '',
        thread: { name: threadName },
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

  const turnLog: TurnLogBuffer = createTurnLogBuffer({
    postThreaded,
    editThreaded,
    options: threadLogOpts,
    threadsEnabled: threadsGloballyEnabled,
  });

  const handlePolicyCard = async (
    message: Extract<ChatMessage, { role: 'policy' }>,
    spaceName: string
  ) => {
    const cards = buildPolicyCard(message);
    try {
      await postTopLevel(spaceName, '', cards);
    } catch (richError) {
      console.warn(
        'Failed to send rich policy request to Google Chat, falling back to plain text:',
        richError
      );
      const policyId = ('requestId' in message && message.requestId) || message.id;
      const text = `Action Required: Policy Request\n\n${
        message.content || 'A pending policy request requires your attention.'
      }\n\nApprove: \`/approve ${policyId}\`\nReject: \`/reject ${policyId} <optional_rationale>\``;
      await postTopLevel(spaceName, text);
    }
  };

  const collapseDestination = (dest: Destination, turnId?: string): Destination => {
    // Both the global `visibility.threads: false` kill switch and the
    // per-space `threadsDisabled` flag mean "quiet bot": drop thread-log
    // activity rather than promoting it top-level. Top-level spam is only
    // opt-in via `filters` (e.g. `/show`), matching pre-threaded behavior.
    if (dest.kind !== 'thread-log') return dest;
    if (!threadsGloballyEnabled) return { kind: 'drop' };
    if (turnId && turnLog.threadsDisabledFor(turnId)) return { kind: 'drop' };
    return dest;
  };

  const handleMessageForChat = async (chatId: string, message: ChatMessage) => {
    const routed = routeMessage(message, filteringConfig);

    // Cron SystemMessages route to `drop` by default (silent mode: the
    // activity log anchors on the agent's reply; nothing posts if it stays
    // silent). In `header` mode, promote back to top-level and swap the
    // prompt text for a terse `🕒 <jobId>` heartbeat.
    const isCronHeader =
      jobsMode === 'header' && message.role === 'system' && message.event === 'cron';

    const effective = collapseDestination(routed, message.turnId);

    if (!isCronHeader && effective.kind === 'drop') return;

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

    if (!isCronHeader && effective.kind === 'thread-log') {
      if (!message.turnId) {
        console.warn(`thread-log event for ${message.role} has no turnId — dropping.`);
        return;
      }
      // No turn context: turnStarted may have been missed (adapter restart,
      // subscription reconnect). Drop silently rather than flooding the space.
      if (!turnLog.has(message.turnId)) return;
      turnLog.append(message.turnId, message);
      return;
    }

    // Top-level.
    if (!isCronHeader && !hasContent && !hasFiles && message.role !== 'policy') return;

    try {
      if (message.role === 'policy' && message.status === 'pending') {
        await handlePolicyCard(message, space.spaceName);
        return;
      }

      let text: string;
      if (isCronHeader) {
        const cron = message as Extract<ChatMessage, { role: 'system' }>;
        const label = cron.jobId ?? 'scheduled';
        text = `🕒 ${label}`;
      } else {
        text = formatMessage(message) || '';
      }

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

      const { threadName: createdThread } = await postTopLevel(space.spaceName, text);

      // If this post belongs to a turn that currently has no anchor, treat it
      // as the implicit root: subsequent thread-log events for the same turn
      // will be posted into the GChat thread that this top-level message just
      // created. Covers cron-triggered and other proactive turns that have no
      // inbound user message to anchor on.
      if (createdThread && message.turnId) {
        if (turnLog.has(message.turnId)) {
          if (!turnLog.isAnchored(message.turnId)) {
            turnLog.assignAnchor(message.turnId, createdThread);
          }
        } else {
          // turnStarted hasn't arrived yet — cache the mapping so it picks
          // up the anchor when it does.
          recordProactiveAnchor(message.id, createdThread);
        }
      }
    } catch (err) {
      console.error('Failed to send message to Google Chat:', err);
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
    // (proactive crons, CLI messages) fall back to the thread created by
    // their first top-level post — recorded in `proactiveAnchors` — so
    // subsequent activity can still anchor into the right thread.
    const entry = externalRef ? resolveInbound(externalRef) : null;
    const proactiveThread = entry ? undefined : proactiveAnchors.get(rootMessageId);
    if (proactiveThread) proactiveAnchors.delete(rootMessageId);

    turnLog.start({
      turnId,
      spaceName: space.spaceName,
      threadsDisabled: space.threadsDisabled,
      anchorThread: entry?.gchatThreadName ?? proactiveThread,
    });
  };

  const handleTurnEnded = async (turnId: string) => {
    await turnLog.end(turnId);
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
    let pending = Promise.resolve();

    type StreamItem =
      | { kind: 'message'; message: ChatMessage }
      | {
          kind: 'turn';
          event:
            | { type: 'started'; turnId: string; rootMessageId: string; externalRef?: string }
            | { type: 'ended'; turnId: string; outcome: 'ok' | 'error' };
        };

    const connect = () => {
      if (signal?.aborted || !activeSubscriptions.has(chatId)) return;

      subscription = trpc.waitForMessages.subscribe(
        { chatId, lastMessageId },
        {
          onData: (items) => {
            retryDelay = 1000;
            if (!Array.isArray(items) || items.length === 0) return;

            pending = pending
              .then(async () => {
                for (const raw of items) {
                  if (signal?.aborted || !activeSubscriptions.has(chatId)) break;
                  const item = raw as StreamItem;
                  if (item.kind === 'message') {
                    await handleMessageForChat(chatId, item.message);
                    await saveLastMessageId(chatId, item.message.id).catch(console.error);
                    lastMessageId = item.message.id;
                  } else if (item.event.type === 'started') {
                    await handleTurnStarted(
                      chatId,
                      item.event.turnId,
                      item.event.rootMessageId,
                      item.event.externalRef
                    );
                  } else {
                    await handleTurnEnded(item.event.turnId);
                  }
                }
              })
              .catch((error) => {
                console.error('Stream queue failed, forcing reconnect...', error);
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
    };

    activeSubscriptions.set(chatId, {
      unsubscribe: () => {
        subscription?.unsubscribe();
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
      turnLog.shutdown();
      resolve();
    });
  });
}
