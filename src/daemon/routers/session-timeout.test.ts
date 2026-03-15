import { describe, it, expect, vi } from 'vitest';
import { createSessionTimeoutRouter } from './session-timeout.js';
import type { RouterState } from './types.js';

// Mock crypto.randomUUID to return a predictable value
vi.mock('node:crypto', () => ({
  randomUUID: () => 'mock-uuid',
}));

describe('sessionTimeoutRouter', () => {
  it('handles the timeout execution branch correctly', () => {
    const router = createSessionTimeoutRouter();
    const initialState: RouterState = {
      messageId: 'msg-1',
      message: '',
      chatId: 'chat-1',
      env: { __SESSION_TIMEOUT__: 'true' },
    };

    const nextState = router(initialState);

    expect(nextState.nextSessionId).toBe('mock-uuid');
    expect(nextState.reply).toBe('Session expired due to inactivity.');
    expect(nextState.jobs?.remove).toContain('__session_timeout__');
    expect(nextState.jobs?.add).toBeUndefined();
  });

  it('handles a standard message by refreshing the timeout job', () => {
    const router = createSessionTimeoutRouter({ timeoutMinutes: 30 });
    const initialState: RouterState = {
      messageId: 'msg-2',
      message: 'Hello!',
      chatId: 'chat-1',
      env: {},
    };

    const nextState = router(initialState);

    expect(nextState.nextSessionId).toBeUndefined();
    expect(nextState.jobs?.remove).toContain('__session_timeout__');
    expect(nextState.jobs?.add).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: '__session_timeout__',
          schedule: { every: '30m' },
          env: { __SESSION_TIMEOUT__: 'true' },
          message: '',
        }),
      ])
    );
  });
});
