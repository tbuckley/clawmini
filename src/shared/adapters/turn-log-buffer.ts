import type { ChatMessage } from '../chats.js';
import {
  buildTurnStartEntry,
  condenseTurnLog,
  formatTurnLogEntry,
  type TurnLogEntry,
} from './turn-log.js';

export interface TurnLogBufferOptions {
  maxToolPreview: number;
  maxLogMessageChars: number;
  editDebounceMs: number;
}

export interface TurnLogBufferDeps<TAnchor> {
  /**
   * Posts a new threaded message under `anchor` and returns the new message's
   * id (whatever the transport uses to address it later for editing). Throws
   * on failure; the buffer treats the *initial* post failure as an
   * unrecoverable per-turn abort.
   */
  postThreaded: (anchor: TAnchor, text: string) => Promise<string | undefined>;
  /** Edits a previously-posted threaded message by id. Throws on failure. */
  editThreaded: (anchor: TAnchor, messageId: string, text: string) => Promise<void>;
  /**
   * Predicate that decides whether an error from `editThreaded` indicates the
   * underlying message no longer exists (e.g. user deleted it). When true,
   * the buffer recovers by posting a fresh log message rather than retrying.
   */
  isMissingMessageError: (err: unknown) => boolean;
  options: TurnLogBufferOptions;
  /** When false, no thread-log activity is ever posted. */
  threadsEnabled: boolean;
}

export interface StartParams<TAnchor> {
  turnId: string;
  /** Per-chat opt-out. When true, thread-log is suppressed for this turn. */
  threadsDisabled: boolean;
  /** Anchor to post into, if known at turn start. */
  anchorThread: TAnchor | undefined;
}

export interface TurnLogBuffer<TAnchor> {
  start(params: StartParams<TAnchor>): void;
  append(turnId: string, message: ChatMessage): void;
  assignAnchor(turnId: string, anchor: TAnchor): void;
  end(turnId: string): Promise<void>;
  has(turnId: string): boolean;
  isAnchored(turnId: string): boolean;
  threadsDisabledFor(turnId: string): boolean;
  shutdown(): void;
}

interface Ctx<TAnchor> {
  turnId: string;
  threadsDisabled: boolean;
  startedAt: string;
  anchor: TAnchor | undefined;
  activityLogMessageId: string | undefined;
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

export function createTurnLogBuffer<TAnchor>(
  deps: TurnLogBufferDeps<TAnchor>
): TurnLogBuffer<TAnchor> {
  const { options, threadsEnabled, postThreaded, editThreaded, isMissingMessageError } = deps;
  const ctxs = new Map<string, Ctx<TAnchor>>();

  const engaged = (ctx: Ctx<TAnchor>) => threadsEnabled && !ctx.threadsDisabled && !ctx.aborted;

  const runFlush = async (ctx: Ctx<TAnchor>): Promise<void> => {
    if (!engaged(ctx)) {
      ctx.entries = [];
      return;
    }
    if (ctx.anchor === undefined) return;
    if (ctx.entries.length === 0) return;

    let result = condenseTurnLog(ctx.entries, { maxChars: options.maxLogMessageChars });

    const send = async (): Promise<void> => {
      const text = result.kind === 'fits' ? result.text : result.finalText;
      if (!ctx.activityLogMessageId) {
        try {
          const id = await postThreaded(ctx.anchor!, text);
          if (id) ctx.activityLogMessageId = id;
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
        await editThreaded(ctx.anchor!, ctx.activityLogMessageId, text);
      } catch (err) {
        if (isMissingMessageError(err)) {
          // The activity-log message is gone (user deleted it, transport
          // returned a "not found" code). Open a fresh log message on the
          // next event rather than retrying the edit.
          console.warn('Log message missing on edit — opening a fresh log message.');
          ctx.activityLogMessageId = undefined;
          try {
            const id = await postThreaded(ctx.anchor!, text);
            if (id) ctx.activityLogMessageId = id;
          } catch (innerErr) {
            console.error('Failed to re-open log message after missing edit:', innerErr);
            ctx.activityLogMessageId = undefined;
          }
        } else {
          await new Promise((resolve) => setTimeout(resolve, 500));
          try {
            await editThreaded(ctx.anchor!, ctx.activityLogMessageId, text);
          } catch (retryErr) {
            console.warn('Edit failed twice — finalizing log message.', retryErr);
            ctx.activityLogMessageId = undefined;
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
      ctx.activityLogMessageId = undefined;
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

  const enqueueFlush = (ctx: Ctx<TAnchor>): void => {
    ctx.flushChain = ctx.flushChain
      .then(() => runFlush(ctx))
      .catch((err) => console.error('Flush error:', err));
  };

  const scheduleFlush = (ctx: Ctx<TAnchor>) => {
    if (!engaged(ctx)) return;
    if (ctx.editTimer) return;
    ctx.editTimer = setTimeout(() => {
      ctx.editTimer = null;
      enqueueFlush(ctx);
    }, options.editDebounceMs);
  };

  return {
    start(params) {
      const ctx: Ctx<TAnchor> = {
        turnId: params.turnId,
        threadsDisabled: params.threadsDisabled,
        startedAt: new Date().toISOString(),
        anchor: params.anchorThread,
        activityLogMessageId: undefined,
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
      if (ctx.anchor !== undefined && engaged(ctx)) {
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
      if (ctx.anchor !== undefined) {
        scheduleFlush(ctx);
      }
    },

    assignAnchor(turnId, anchor) {
      const ctx = ctxs.get(turnId);
      if (!ctx) return;
      if (ctx.anchor !== undefined) return;
      ctx.anchor = anchor;
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
      return ctx?.anchor !== undefined;
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
