import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  recordInbound,
  resolveInbound,
  INBOUND_TTL_MS,
  _resetInboundCacheForTests,
} from './inbound-cache.js';

describe('discord inbound-cache', () => {
  beforeEach(() => {
    _resetInboundCacheForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('records and resolves an inbound by message id', () => {
    recordInbound({ messageId: 'msg-1', channelId: 'chan-1' });
    expect(resolveInbound('msg-1')).toMatchObject({
      messageId: 'msg-1',
      channelId: 'chan-1',
    });
  });

  it('returns null for unknown keys', () => {
    expect(resolveInbound('unknown')).toBeNull();
  });

  it('expires entries older than INBOUND_TTL_MS on resolve', () => {
    vi.useFakeTimers();
    recordInbound({ messageId: 'msg-1', channelId: 'chan-1' });
    expect(resolveInbound('msg-1')).not.toBeNull();

    vi.advanceTimersByTime(INBOUND_TTL_MS + 1000);
    expect(resolveInbound('msg-1')).toBeNull();
  });

  it('sweeps expired entries on every insert', () => {
    vi.useFakeTimers();
    recordInbound({ messageId: 'msg-1', channelId: 'chan-1' });
    vi.advanceTimersByTime(INBOUND_TTL_MS + 1000);
    recordInbound({ messageId: 'msg-2', channelId: 'chan-2' });
    expect(resolveInbound('msg-1')).toBeNull();
    expect(resolveInbound('msg-2')).not.toBeNull();
  });
});
