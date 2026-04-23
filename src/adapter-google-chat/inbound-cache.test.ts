import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  recordInbound,
  resolveInbound,
  INBOUND_TTL_MS,
  _resetInboundCacheForTests,
} from './inbound-cache.js';

describe('inbound-cache', () => {
  beforeEach(() => {
    _resetInboundCacheForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('records and resolves an inbound by gchatMessageName', () => {
    recordInbound({
      gchatMessageName: 'spaces/x/messages/m1',
      gchatThreadName: 'spaces/x/threads/t1',
    });
    const record = resolveInbound('spaces/x/messages/m1');
    expect(record).toMatchObject({
      gchatMessageName: 'spaces/x/messages/m1',
      gchatThreadName: 'spaces/x/threads/t1',
    });
  });

  it('returns null for unknown keys', () => {
    expect(resolveInbound('spaces/x/messages/unknown')).toBeNull();
  });

  it('expires entries older than INBOUND_TTL_MS on resolve', () => {
    vi.useFakeTimers();
    recordInbound({
      gchatMessageName: 'spaces/x/messages/m1',
      gchatThreadName: 'spaces/x/threads/t1',
    });
    expect(resolveInbound('spaces/x/messages/m1')).not.toBeNull();

    vi.advanceTimersByTime(INBOUND_TTL_MS + 1000);
    expect(resolveInbound('spaces/x/messages/m1')).toBeNull();
  });

  it('sweeps expired entries on every insert', () => {
    vi.useFakeTimers();
    recordInbound({
      gchatMessageName: 'spaces/x/messages/m1',
      gchatThreadName: 'spaces/x/threads/t1',
    });
    vi.advanceTimersByTime(INBOUND_TTL_MS + 1000);
    recordInbound({
      gchatMessageName: 'spaces/x/messages/m2',
      gchatThreadName: 'spaces/x/threads/t2',
    });
    // m1 should have been swept when m2 was inserted.
    expect(resolveInbound('spaces/x/messages/m1')).toBeNull();
    expect(resolveInbound('spaces/x/messages/m2')).not.toBeNull();
  });
});
