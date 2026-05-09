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
  /**
   * Total attempts (including the first) for a single transport call before
   * giving up on this flush. Failures don't abort the turn — entries stay in
   * the buffer and the next flush retries — but capping per-flush attempts
   * keeps a stuck call from blocking the flush chain forever.
   */
  maxAttempts?: number;
  /**
   * Initial backoff between attempts. Doubles each retry (capped at ~5s).
   */
  retryBaseDelayMs?: number;
}

export interface TurnLogBufferDeps<TAnchor> {
  /**
   * Posts a new threaded message under `anchor` and returns the new message's
   * id (whatever the transport uses to address it later for editing). Throws
   * on failure; the buffer retries with backoff and, if all attempts fail,
   * keeps the entries queued for a later flush rather than aborting.
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
   * Tracks how many flush attempts in a row failed. Used only for log-line
   * throttling so a totally-broken anchor doesn't spam stderr; the buffer
   * still retries every flush.
   */
  consecutiveFailures: number;
}

const DEFAULT_MAX_ATTEMPTS = 4;
const DEFAULT_RETRY_BASE_DELAY_MS = 500;
const MAX_BACKOFF_MS = 5_000;

export function createTurnLogBuffer<TAnchor>(
  deps: TurnLogBufferDeps<TAnchor>
): TurnLogBuffer<TAnchor> {
  const { options, threadsEnabled, postThreaded, editThreaded, isMissingMessageError } = deps;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const retryBaseDelayMs = options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
  const ctxs = new Map<string, Ctx<TAnchor>>();

  const engaged = (ctx: Ctx<TAnchor>) => threadsEnabled && !ctx.threadsDisabled;

  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  /**
   * Best-effort post-or-edit with bounded retries. Returns true if the
   * message landed, false if every attempt failed. Never throws and never
   * aborts the turn — the buffer keeps retrying on subsequent flushes.
   */
  const sendOnce = async (ctx: Ctx<TAnchor>, text: string): Promise<boolean> => {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        if (!ctx.activityLogMessageId) {
          const id = await postThreaded(ctx.anchor!, text);
          if (id) ctx.activityLogMessageId = id;
          return true;
        }
        try {
          await editThreaded(ctx.anchor!, ctx.activityLogMessageId, text);
          return true;
        } catch (err) {
          if (isMissingMessageError(err)) {
            // The activity-log message is gone (user deleted it, transport
            // returned a "not found" code). Drop the id and let the next
            // attempt of this same loop post a fresh message.
            ctx.activityLogMessageId = undefined;
            continue;
          }
          throw err;
        }
      } catch (err) {
        const isLast = attempt === maxAttempts - 1;
        if (isLast) {
          // Throttle the warning so a wedged anchor doesn't spam stderr —
          // log on the first failure, then once every few failures.
          if (ctx.consecutiveFailures % 5 === 0) {
            console.warn(
              `Turn-log send failed after ${maxAttempts} attempts for turn ${ctx.turnId}; will retry on next flush.`,
              err
            );
          }
          return false;
        }
        const delay = Math.min(retryBaseDelayMs * 2 ** attempt, MAX_BACKOFF_MS);
        await sleep(delay);
      }
    }
    return false;
  };

  const runFlush = async (ctx: Ctx<TAnchor>): Promise<void> => {
    if (!engaged(ctx)) {
      ctx.entries = [];
      return;
    }
    if (ctx.anchor === undefined) return;
    if (ctx.entries.length === 0) return;

    // Loop because a single flush can rollover multiple times when the
    // backlog is large relative to maxLogMessageChars.
    while (ctx.entries.length > 0) {
      // Snapshot what we're about to flush. Anything appended *during* the
      // await stays in ctx.entries beyond the snapshot index and is preserved
      // across rollover (see the carry math below).
      const snapshotCount = ctx.entries.length;
      const snapshot = ctx.entries.slice(0, snapshotCount);
      const result = condenseTurnLog(snapshot, { maxChars: options.maxLogMessageChars });

      const text = result.kind === 'fits' ? result.text : result.finalText;
      const ok = await sendOnce(ctx, text);

      if (!ok) {
        ctx.consecutiveFailures += 1;
        // Keep entries; next flush will retry. Bail out of the rollover loop
        // so we don't burn through retry budget on every iteration of a
        // problem that needs caller-side backoff (rate limits, etc.).
        return;
      }
      ctx.consecutiveFailures = 0;

      if (result.kind === 'fits') {
        // The message now reflects `snapshot`; whatever came in during the
        // await is still queued in ctx.entries past `snapshotCount`. Don't
        // touch entries — the next flush re-condenses everything (snapshot +
        // appended-during-await) and edits the message in place.
        return;
      }

      // Rollover: the message we just sent is sealed; the next iteration
      // posts a fresh message. Carry the leftover from condense PLUS anything
      // that was appended during the await — the prior implementation
      // overwrote ctx.entries with carryEntries and silently dropped those
      // concurrent appends.
      const appendedDuringAwait = ctx.entries.slice(snapshotCount);
      ctx.entries = [...result.carryEntries, ...appendedDuringAwait];
      ctx.activityLogMessageId = undefined;

      // Degenerate case: a single entry's rendered line is itself larger
      // than the per-message budget. condenseTurnLog already truncates and
      // returns the rest as carry, but if the carry hasn't shrunk relative
      // to the snapshot we drop the head to make progress.
      if (result.carryEntries.length >= snapshot.length) {
        console.warn(
          `Turn-log entry larger than maxLogMessageChars — dropping head for turn ${ctx.turnId}`
        );
        ctx.entries = ctx.entries.slice(1);
      }
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
        consecutiveFailures: 0,
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
