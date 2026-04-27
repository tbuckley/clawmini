import { describe, it, expect, vi, afterEach } from 'vitest';
import { createInboundCache } from './inbound-cache.js';

const TTL_MS = 10 * 60 * 1000;

describe('createInboundCache', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('records and resolves a value by key', () => {
    const cache = createInboundCache<{ channelId: string }>(TTL_MS);
    cache.record('msg-1', { channelId: 'chan-1' });
    expect(cache.resolve('msg-1')).toEqual({ channelId: 'chan-1' });
  });

  it('returns null for unknown keys', () => {
    const cache = createInboundCache<{ channelId: string }>(TTL_MS);
    expect(cache.resolve('unknown')).toBeNull();
  });

  it('expires entries older than ttlMs on resolve', () => {
    vi.useFakeTimers();
    const cache = createInboundCache<{ channelId: string }>(TTL_MS);
    cache.record('msg-1', { channelId: 'chan-1' });
    expect(cache.resolve('msg-1')).not.toBeNull();

    vi.advanceTimersByTime(TTL_MS + 1000);
    expect(cache.resolve('msg-1')).toBeNull();
  });

  it('sweeps expired entries on every insert', () => {
    vi.useFakeTimers();
    const cache = createInboundCache<{ channelId: string }>(TTL_MS);
    cache.record('msg-1', { channelId: 'chan-1' });
    vi.advanceTimersByTime(TTL_MS + 1000);
    cache.record('msg-2', { channelId: 'chan-2' });
    expect(cache.resolve('msg-1')).toBeNull();
    expect(cache.resolve('msg-2')).not.toBeNull();
  });

  it('reset() drops all entries', () => {
    const cache = createInboundCache<{ channelId: string }>(TTL_MS);
    cache.record('msg-1', { channelId: 'chan-1' });
    cache.reset();
    expect(cache.resolve('msg-1')).toBeNull();
  });
});
