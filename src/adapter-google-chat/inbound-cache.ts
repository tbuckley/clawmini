/**
 * In-memory inbound message cache. The adapter's ingestion and forwarder
 * both run in the same Node process (`startGoogleChatIngestion` and
 * `startDaemonToGoogleChatForwarder` start side-by-side in `index.ts`), so
 * the disk-persisted ring buffer that existed historically is unnecessary.
 *
 * Ingestion records each inbound by its `gchatMessageName` (also sent to
 * the daemon as `externalRef`). When the forwarder later sees
 * `turnStarted` with that `externalRef`, it resolves the thread anchor by
 * looking up the same key here.
 *
 * Entries older than `INBOUND_TTL_MS` are swept on every insert — bounded
 * memory without an LRU. The common case (daemon runs indefinitely and
 * adapter stays up alongside it) is fully covered; adapter restart
 * mid-turn loses the cache and is an explicit tradeoff.
 */

interface InboundRecord {
  gchatMessageName: string;
  gchatThreadName: string;
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

export function recordInbound(entry: { gchatMessageName: string; gchatThreadName: string }): void {
  const now = Date.now();
  sweep(now);
  cache.set(entry.gchatMessageName, {
    gchatMessageName: entry.gchatMessageName,
    gchatThreadName: entry.gchatThreadName,
    receivedAt: now,
  });
}

export function resolveInbound(gchatMessageName: string): InboundRecord | null {
  const record = cache.get(gchatMessageName);
  if (!record) return null;
  if (Date.now() - record.receivedAt > INBOUND_TTL_MS) {
    cache.delete(gchatMessageName);
    return null;
  }
  return record;
}

/** Test hook: drop all cached records. */
export function _resetInboundCacheForTests(): void {
  cache.clear();
}
