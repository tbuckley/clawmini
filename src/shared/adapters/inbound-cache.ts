/**
 * Generic in-memory inbound message cache shared by adapters that need to
 * correlate a daemon `turnStarted` event with the inbound message that
 * triggered it.
 *
 * Adapters whose ingestion and forwarder run in the same Node process don't
 * need disk persistence: a `Map` keyed by external ref (the same id sent to
 * the daemon as `externalRef`) is enough. Entries older than `ttlMs` are
 * swept on every insert — bounded memory without an LRU. Adapter restart
 * mid-turn loses the cache; that is an explicit tradeoff.
 */
export interface InboundCache<TValue> {
  record(key: string, value: TValue): void;
  resolve(key: string): TValue | null;
  /** Test hook: drop all cached records. */
  reset(): void;
}

interface Entry<TValue> {
  value: TValue;
  receivedAt: number;
}

export function createInboundCache<TValue>(ttlMs: number): InboundCache<TValue> {
  const cache = new Map<string, Entry<TValue>>();

  const sweep = (now: number): void => {
    for (const [key, entry] of cache) {
      if (now - entry.receivedAt > ttlMs) cache.delete(key);
    }
  };

  return {
    record(key, value) {
      const now = Date.now();
      sweep(now);
      cache.set(key, { value, receivedAt: now });
    },

    resolve(key) {
      const entry = cache.get(key);
      if (!entry) return null;
      if (Date.now() - entry.receivedAt > ttlMs) {
        cache.delete(key);
        return null;
      }
      return entry.value;
    },

    reset() {
      cache.clear();
    },
  };
}
