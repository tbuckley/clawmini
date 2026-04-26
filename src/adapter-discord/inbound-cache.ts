/**
 * Discord-side wrapper around the shared inbound-message TTL cache.
 *
 * On every inbound user message, the gateway records `{ messageId, channelId
 * }`. The same `messageId` is sent to the daemon as `externalRef` on the
 * `sendMessage` mutation. When the forwarder later sees `turnStarted` with
 * that `externalRef`, it resolves the channel + message id and starts a
 * Discord thread anchored on the user's message.
 */
import { createInboundCache } from '../shared/adapters/inbound-cache.js';

export const INBOUND_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface DiscordInboundValue {
  channelId: string;
}

const cache = createInboundCache<DiscordInboundValue>(INBOUND_TTL_MS);

export interface DiscordInboundRecord {
  messageId: string;
  channelId: string;
}

export function recordInbound(entry: DiscordInboundRecord): void {
  cache.record(entry.messageId, { channelId: entry.channelId });
}

export function resolveInbound(messageId: string): DiscordInboundRecord | null {
  const value = cache.resolve(messageId);
  return value ? { messageId, channelId: value.channelId } : null;
}

/** Test hook: drop all cached records. */
export function _resetInboundCacheForTests(): void {
  cache.reset();
}
