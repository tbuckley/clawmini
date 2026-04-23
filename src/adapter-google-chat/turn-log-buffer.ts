import type { ChatMessage } from '../shared/chats.js';
import {
  buildTurnStartEntry,
  condenseTurnLog,
  formatTurnLogEntry,
  type TurnLogEntry,
} from '../shared/adapters/turn-log.js';

export interface TurnLogBufferOptions {
  maxToolPreview: number;
  maxLogMessageChars: number;
  editDebounceMs: number;
}

export interface TurnLogBufferDeps {
  /**
   * Opens a new threaded message and returns its resource name. Throws on
   * failure; the buffer treats that as an unrecoverable per-turn abort.
   */
  postThreaded: (
    spaceName: string,
    threadName: string,
    text: string
  ) => Promise<string | undefined>;
  /** Edits an existing threaded message by name. Throws on failure. */
  editThreaded: (messageName: string, text: string) => Promise<void>;
  options: TurnLogBufferOptions;
  /** When false, no thread-log activity is ever posted. */
  threadsEnabled: boolean;
}

export interface StartParams {
  turnId: string;
  spaceName: string;
  /** Per-chat opt-out. When true, thread-log is suppressed for this turn. */
  threadsDisabled: boolean;
  /** GChat thread name to post into, if known at turn start. */
  anchorThread: string | undefined;
}

export interface TurnLogBuffer {
  start(params: StartParams): void;
  append(turnId: string, message: ChatMessage): void;
  assignAnchor(turnId: string, threadName: string): void;
  end(turnId: string): Promise<void>;
  has(turnId: string): boolean;
  isAnchored(turnId: string): boolean;
  threadsDisabledFor(turnId: string): boolean;
  shutdown(): void;
}

interface Ctx {
  turnId: string;
  spaceName: string;
  threadsDisabled: boolean;
  startedAt: string;
  gchatThreadName: string | undefined;
  activityLogMessageName: string | undefined;
  entries: TurnLogEntry[];
  editTimer: NodeJS.Timeout | null;
  flushChain: Promise<void>;
  /**
   * Once the thread-log post fails, the whole turn's activity log is
   * abandoned: subsequent appends drop silently rather than trying to post
   * anything else. Matches the user-level expectation that if the thread
   * never opened, we simply stop logging for that turn.
   */
  aborted: boolean;
}

export function createTurnLogBuffer(deps: TurnLogBufferDeps): TurnLogBuffer {
  const { options, threadsEnabled, postThreaded, editThreaded } = deps;
  const ctxs = new Map<string, Ctx>();

  const engaged = (ctx: Ctx) => threadsEnabled && !ctx.threadsDisabled && !ctx.aborted;

  const runFlush = async (ctx: Ctx): Promise<void> => {
    if (!engaged(ctx)) {
      ctx.entries = [];
      return;
    }
    if (!ctx.gchatThreadName) return;
    if (ctx.entries.length === 0) return;

    let result = condenseTurnLog(ctx.entries, { maxChars: options.maxLogMessageChars });

    const send = async (): Promise<void> => {
      const text = result.kind === 'fits' ? result.text : result.finalText;
      if (!ctx.activityLogMessageName) {
        try {
          const name = await postThreaded(ctx.spaceName, ctx.gchatThreadName!, text);
          if (name) ctx.activityLogMessageName = name;
        } catch (err) {
          console.error(
            `Failed to open thread-log for turn ${ctx.turnId}; dropping further thread-log events for this turn.`,
            err
          );
          ctx.aborted = true;
          ctx.entries = [];
        }
        return;
      }
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
    };

    await send();

    // On rollover, the finalized message is sealed; carry-over entries seed a
    // brand-new activity-log message. A single flush can rollover multiple
    // times (tight budget with several entries), so loop until the carry fits
    // or is empty.
    while (!ctx.aborted && result.kind === 'rollover') {
      const prevLen = ctx.entries.length;
      ctx.entries = result.carryEntries.slice();
      ctx.activityLogMessageName = undefined;
      if (ctx.entries.length === 0) break;
      // Degenerate case: a single entry's rendered line is itself larger
      // than the per-message budget. Drop the stuck head so we can make
      // progress rather than spinning the flush loop forever.
      if (ctx.entries.length >= prevLen) {
        console.warn(
          `Turn-log entry larger than maxLogMessageChars — dropping head for turn ${ctx.turnId}`
        );
        ctx.entries = ctx.entries.slice(1);
        if (ctx.entries.length === 0) break;
      }
      result = condenseTurnLog(ctx.entries, { maxChars: options.maxLogMessageChars });
      await send();
    }
  };

  const enqueueFlush = (ctx: Ctx): void => {
    ctx.flushChain = ctx.flushChain
      .then(() => runFlush(ctx))
      .catch((err) => console.error('Flush error:', err));
  };

  const scheduleFlush = (ctx: Ctx) => {
    if (!engaged(ctx)) return;
    if (ctx.editTimer) return;
    ctx.editTimer = setTimeout(() => {
      ctx.editTimer = null;
      enqueueFlush(ctx);
    }, options.editDebounceMs);
  };

  return {
    start(params) {
      const ctx: Ctx = {
        turnId: params.turnId,
        spaceName: params.spaceName,
        threadsDisabled: params.threadsDisabled,
        startedAt: new Date().toISOString(),
        gchatThreadName: params.anchorThread,
        activityLogMessageName: undefined,
        // Seed the turn's activity log with an opening entry so the thread
        // appears as soon as the turn starts, rather than only after the first
        // tool call / subagent event. Skipped when threads are disabled.
        entries: threadsEnabled && !params.threadsDisabled ? [buildTurnStartEntry()] : [],
        editTimer: null,
        flushChain: Promise.resolve(),
        aborted: false,
      };
      ctxs.set(params.turnId, ctx);
      // If the anchor is known at start (inbound-user turn, or proactive turn
      // whose top-level post already landed), flush immediately so the
      // "Started processing…" line appears without waiting for the debounce.
      if (ctx.gchatThreadName && engaged(ctx)) {
        enqueueFlush(ctx);
      }
    },

    append(turnId, message) {
      const ctx = ctxs.get(turnId);
      if (!ctx) return;
      if (!engaged(ctx)) return;
      const entry = formatTurnLogEntry(message, {
        maxToolPreview: options.maxToolPreview,
        turnStartedAt: ctx.startedAt,
      });
      if (!entry) return;
      ctx.entries.push(entry);
      // Without an anchor yet, entries accumulate; assignAnchor will flush
      // them once the anchor arrives.
      if (ctx.gchatThreadName) {
        scheduleFlush(ctx);
      }
    },

    assignAnchor(turnId, threadName) {
      const ctx = ctxs.get(turnId);
      if (!ctx) return;
      if (ctx.gchatThreadName) return;
      ctx.gchatThreadName = threadName;
      if (engaged(ctx) && ctx.entries.length > 0) {
        enqueueFlush(ctx);
      }
    },

    async end(turnId) {
      const ctx = ctxs.get(turnId);
      if (!ctx) return;
      if (ctx.editTimer) {
        clearTimeout(ctx.editTimer);
        ctx.editTimer = null;
      }
      // Tack a final flush onto the chain so any pending entries are sent.
      enqueueFlush(ctx);
      try {
        await ctx.flushChain;
      } catch (err) {
        console.error('Final flush error:', err);
      }
      ctxs.delete(turnId);
    },

    has(turnId) {
      return ctxs.has(turnId);
    },

    isAnchored(turnId) {
      const ctx = ctxs.get(turnId);
      return !!ctx?.gchatThreadName;
    },

    threadsDisabledFor(turnId) {
      const ctx = ctxs.get(turnId);
      return ctx?.threadsDisabled ?? false;
    },

    shutdown() {
      for (const ctx of ctxs.values()) {
        if (ctx.editTimer) clearTimeout(ctx.editTimer);
      }
      ctxs.clear();
    },
  };
}
