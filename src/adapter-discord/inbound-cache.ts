/**
 * In-memory inbound message cache for the Discord adapter. The adapter's
 * inbound (gateway) handler and the daemon-to-Discord forwarder both run in
 * the same Node process, so a disk-persisted cache isn't needed.
 *
 * On every inbound user message, the gateway records `{ messageId, channelId
 * }`. The same `messageId` is sent to the daemon as `externalRef` on the
 * `sendMessage` mutation. When the forwarder later sees `turnStarted` with
 * that `externalRef`, it resolves the channel + message id and starts a
 * Discord thread anchored on the user's message — the same shape as Google
 * Chat's anchor flow.
 *
 * Entries older than `INBOUND_TTL_MS` are swept on every insert. The common
 * case (long-running adapter) is fully covered; adapter restart mid-turn
 * loses the cache and is an explicit tradeoff.
 */

interface InboundRecord {
  messageId: string;
  channelId: string;
  receivedAt: number;
}

export const INBOUND_TTL_MS = 10 * 60 * 1000; // 10 minutes

const cache = new Map<string, InboundRecord>();

function sweep(now: number): void {
  for (const [key, record] of cache) {
    if (now - record.receivedAt > INBOUND_TTL_MS) {
      cache.delete(key);
    }
  }
}

export function recordInbound(entry: { messageId: string; channelId: string }): void {
  const now = Date.now();
  sweep(now);
  cache.set(entry.messageId, {
    messageId: entry.messageId,
    channelId: entry.channelId,
    receivedAt: now,
  });
}

export function resolveInbound(messageId: string): InboundRecord | null {
  const record = cache.get(messageId);
  if (!record) return null;
  if (Date.now() - record.receivedAt > INBOUND_TTL_MS) {
    cache.delete(messageId);
    return null;
  }
  return record;
}

/** Test hook: drop all cached records. */
export function _resetInboundCacheForTests(): void {
  cache.clear();
}
