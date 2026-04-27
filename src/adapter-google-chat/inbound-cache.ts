/**
 * Google Chat-side wrapper around the shared inbound-message TTL cache.
 *
 * Ingestion records each inbound by its `gchatMessageName` (also sent to the
 * daemon as `externalRef`). When the forwarder later sees `turnStarted` with
 * that `externalRef`, it resolves the thread anchor by looking up the same
 * key here.
 */
import { createInboundCache } from '../shared/adapters/inbound-cache.js';

export const INBOUND_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface GChatInboundValue {
  gchatThreadName: string;
}

const cache = createInboundCache<GChatInboundValue>(INBOUND_TTL_MS);

export interface GChatInboundRecord {
  gchatMessageName: string;
  gchatThreadName: string;
}

export function recordInbound(entry: GChatInboundRecord): void {
  cache.record(entry.gchatMessageName, { gchatThreadName: entry.gchatThreadName });
}

export function resolveInbound(gchatMessageName: string): GChatInboundRecord | null {
  const value = cache.resolve(gchatMessageName);
  return value ? { gchatMessageName, gchatThreadName: value.gchatThreadName } : null;
}

/** Test hook: drop all cached records. */
export function _resetInboundCacheForTests(): void {
  cache.reset();
}
