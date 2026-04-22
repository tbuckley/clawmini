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
import {
  formatTurnLogEntry,
  condenseTurnLog,
  buildTurnStartEntry,
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
  /**
   * True while a `flushTurnLog` call for this ctx is awaiting the GChat API.
   * Concurrent callers set `flushRequested` instead of starting a second
   * flush; the active flush re-runs when it sees the flag.
   */
  flushing: boolean;
  flushRequested: boolean;
  degraded: boolean;
  threadsDisabled: boolean;
  /**
   * Wall-clock timestamp of the turnStarted event; used to render relative
   * timestamps in the activity log (`0s`, `5s`, `1m5s`).
   */
  startedAt: string;
}

const DEFAULT_THREAD_LOG_OPTS: ThreadLogOptions = {
  maxToolPreview: 400,
  maxLogMessageChars: 3500,
  editDebounceMs: 1000,
  condenseStrategy: 'rollover',
};

/**
 * Belt-and-suspenders sweep for `TurnContext` entries that never see their
 * `turnEnded`. Normally the daemon's registry force-ends stuck turns at
 * ~30min and we delete on `turnEnded`, but if that event is lost in transit
 * (adapter restart, subscription reconnect, etc.) we don't want contexts to
 * accumulate indefinitely on a long-running daemon.
 */
const TURN_CONTEXT_TTL_MS = 30 * 60 * 1000;
const TURN_CONTEXT_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

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

  const activeSubscriptions = new Map<string, { unsubscribe: () => void }>();
  const turnContexts = new Map<string, TurnContext>();
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

  const flushTurnLog = async (ctx: TurnContext): Promise<void> => {
    if (ctx.editTimer) {
      clearTimeout(ctx.editTimer);
      ctx.editTimer = undefined;
    }

    // Serialize flushes per-ctx: if a flush is already in flight, request a
    // follow-up run and bail. The active flush will loop and pick up any
    // entries that arrived while it was awaiting the GChat API.
    if (ctx.flushing) {
      ctx.flushRequested = true;
      return;
    }

    ctx.flushing = true;
    try {
      do {
        ctx.flushRequested = false;
        if (ctx.entries.length === 0) return;
        if (!ctx.spaceName || !ctx.gchatThreadName) return;
        // Degraded contexts route at dispatch time (handleMessageForChat), so
        // we never accumulate entries here; any left over are stale.
        if (ctx.degraded) {
          ctx.entries = [];
          return;
        }

        let result = condenseTurnLog(ctx.entries, {
          maxChars: threadLogOpts.maxLogMessageChars,
          strategy: threadLogOpts.condenseStrategy,
        });

        const send = async (): Promise<void> => {
          const text = result.kind === 'fits' ? result.text : result.finalText;
          if (!ctx.activityLogMessageName) {
            try {
              const name = await postThreaded(ctx.spaceName, ctx.gchatThreadName!, text);
              if (name) ctx.activityLogMessageName = name;
            } catch (err) {
              console.error('Failed to open thread-log message, falling back to top-level:', err);
              ctx.degraded = true;
              // Flush the buffered entries as a single top-level post so the
              // user sees the activity that triggered thread creation.
              try {
                await postTopLevel(ctx.spaceName, text);
              } catch (innerErr) {
                console.error('Top-level fallback also failed:', innerErr);
              }
              ctx.entries = [];
              return;
            }
          } else {
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
        // seed a brand-new activity-log message. A single turn can rollover
        // multiple times in one flush (e.g. 3 entries against a tight budget
        // where each pair overflows), so loop until the carry fits or is
        // empty. Otherwise keep `entries` intact so the next debounced edit
        // re-renders the full history plus new events, rather than
        // overwriting the message with only the latest entry.
        while (result.kind === 'rollover') {
          const prevLen = ctx.entries.length;
          ctx.entries = result.carryEntries.slice();
          ctx.activityLogMessageName = undefined;
          if (ctx.entries.length === 0) break;
          // Degenerate case: a single entry's rendered line is itself larger
          // than the per-message budget. The condenser already emitted the
          // rollover marker; drop the stuck head so we can make progress on
          // the rest rather than spin the flush loop forever.
          if (ctx.entries.length >= prevLen) {
            console.warn(
              `Turn-log entry larger than maxLogMessageChars — dropping head for turn ${ctx.turnId}`
            );
            ctx.entries = ctx.entries.slice(1);
            if (ctx.entries.length === 0) break;
          }
          result = condenseTurnLog(ctx.entries, {
            maxChars: threadLogOpts.maxLogMessageChars,
            strategy: threadLogOpts.condenseStrategy,
          });
          await send();
        }
      } while (ctx.flushRequested && ctx.entries.length > 0 && !ctx.degraded);
    } finally {
      ctx.flushing = false;
    }
  };

  const scheduleFlush = (ctx: TurnContext) => {
    if (ctx.editTimer) return;
    // A flush is already in flight: it will loop and re-read `entries`. Just
    // set the request flag; no timer needed.
    if (ctx.flushing) {
      ctx.flushRequested = true;
      return;
    }
    ctx.editTimer = setTimeout(() => {
      ctx.editTimer = undefined;
      flushTurnLog(ctx).catch((err) => console.error('Flush error:', err));
    }, threadLogOpts.editDebounceMs);
  };

  const collapseDestination = (dest: Destination, ctx?: TurnContext | null): Destination => {
    if (!threadsGloballyEnabled) {
      if (dest.kind === 'thread-log') return { kind: 'drop' };
    }
    if (ctx?.threadsDisabled) {
      if (dest.kind === 'thread-log') return { kind: 'top-level' };
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

    if (effective.kind === 'thread-log') {
      // Degraded: thread-log create failed earlier in this turn. Keep
      // activity visible by rendering each entry as its own top-level
      // message instead of silently buffering it into a thread that was
      // never opened.
      if (ctx?.degraded) {
        const entry = formatTurnLogEntry(message, {
          maxToolPreview: threadLogOpts.maxToolPreview,
          turnStartedAt: ctx.startedAt,
        });
        if (!entry) return;
        const rendered = condenseTurnLog([entry], { maxChars: 4000 });
        if (rendered.kind !== 'fits' || !rendered.text) return;
        try {
          await postTopLevel(space.spaceName, rendered.text);
        } catch (err) {
          console.error('Degraded thread-log top-level post failed:', err);
        }
        return;
      }
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
        turnStartedAt: ctx.startedAt,
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

      const { threadName: createdThread } = await postTopLevel(space.spaceName, text);

      // If this post belongs to a turn that currently has no anchor, treat it
      // as the implicit root: subsequent thread-log events for the same turn
      // will be posted into the GChat thread that this top-level message just
      // created. Covers cron-triggered and other proactive turns that have no
      // inbound user message to anchor on.
      if (createdThread && message.turnId) {
        if (ctx && !ctx.gchatThreadName) {
          ctx.gchatThreadName = createdThread;
          // The turn's opening entry was buffered waiting for this anchor;
          // flush now so the activity thread opens right under the post that
          // just created it.
          if (ctx.entries.length > 0 && !ctx.threadsDisabled && threadsGloballyEnabled) {
            flushTurnLog(ctx).catch((err) => console.error('Flush-on-anchor error:', err));
          }
        } else if (!ctx) {
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

    const ctx: TurnContext = {
      turnId,
      chatId,
      spaceName: space.spaceName,
      rootDaemonMessageId: rootMessageId,
      rootGchatMessageName: entry?.gchatMessageName,
      gchatThreadName: entry?.gchatThreadName ?? proactiveThread,
      activityLogMessageName: undefined,
      // Seed the turn's activity log with an opening entry so the thread
      // appears as soon as the turn starts, rather than only after the first
      // tool call / subagent event. Skipped when threads are disabled.
      entries: space.threadsDisabled || !threadsGloballyEnabled ? [] : [buildTurnStartEntry()],
      editTimer: undefined,
      flushing: false,
      flushRequested: false,
      degraded: false,
      threadsDisabled: space.threadsDisabled,
      startedAt: new Date().toISOString(),
    };
    turnContexts.set(turnId, ctx);

    // If the thread anchor is available now (inbound-user turn, or proactive
    // turn whose top-level post already landed), flush immediately so the
    // "Started processing…" message appears without waiting for the debounce
    // window. Otherwise the first top-level post in `handleMessageForChat`
    // will assign `gchatThreadName` and trigger the flush there.
    if (ctx.gchatThreadName && !ctx.threadsDisabled && threadsGloballyEnabled) {
      flushTurnLog(ctx).catch((err) => console.error('Initial flush error:', err));
    }
  };

  const handleTurnEnded = async (turnId: string) => {
    const ctx = turnContexts.get(turnId);
    if (!ctx) return;
    // With the daemon deferring `turnEnded` until all subagents settle,
    // arrival of this event means no more activity is coming on `turnId`.
    // Flush anything pending, then drop the context.
    await flushTurnLog(ctx).catch((err) => console.error('Final flush error:', err));
    if (ctx.editTimer) clearTimeout(ctx.editTimer);
    turnContexts.delete(turnId);
  };

  const sweepStaleTurnContexts = () => {
    const now = Date.now();
    for (const [turnId, ctx] of turnContexts) {
      const age = now - Date.parse(ctx.startedAt);
      if (Number.isFinite(age) && age > TURN_CONTEXT_TTL_MS) {
        console.warn(
          `Dropping stale turn context ${turnId} after ${Math.round(age / 1000)}s ` +
            `without turnEnded — daemon registry's force-end likely did not reach the adapter.`
        );
        if (ctx.editTimer) clearTimeout(ctx.editTimer);
        turnContexts.delete(turnId);
      }
    }
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

    const sweepInterval = setInterval(sweepStaleTurnContexts, TURN_CONTEXT_SWEEP_INTERVAL_MS);
    sweepInterval.unref();

    signal?.addEventListener('abort', () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      clearInterval(sweepInterval);
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
