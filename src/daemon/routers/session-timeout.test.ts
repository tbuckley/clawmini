import { describe, it, expect, vi } from 'vitest';
import { createSessionTimeoutRouter } from './session-timeout.js';
import type { RouterState } from './types.js';

// Mock crypto.randomUUID to return a predictable value
vi.mock('node:crypto', () => ({
  randomUUID: () => 'mock-uuid',
}));

describe('sessionTimeoutRouter', () => {
  it('refreshes the timeout job with default settings', () => {
    const router = createSessionTimeoutRouter();
    const initialState: RouterState = {
      messageId: 'msg-1',
      message: 'Hello!',
      chatId: 'chat-1',
    };

    const nextState = router(initialState);

    expect(nextState.nextSessionId).toBeUndefined(); // Should not modify current session
    expect(nextState.jobs?.remove).toContain('__session_timeout__');
    expect(nextState.jobs?.add).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: '__session_timeout__',
          schedule: { at: '60m' },
          message:
            'This chat session has ended. Save any important details from it to your memory.',
          reply: '[@clawmini/session-timeout] Starting a fresh session...',
          nextSessionId: 'mock-uuid',
          jobs: {
            remove: ['__session_timeout__'],
          },
        }),
      ])
    );
  });

  it('respects custom timeoutMinutes and prompt configuration', () => {
    const router = createSessionTimeoutRouter({
      timeoutMinutes: 30,
      prompt: 'Custom prompt',
    });
    const initialState: RouterState = {
      messageId: 'msg-2',
      message: 'Hello again!',
      chatId: 'chat-1',
    };

    const nextState = router(initialState);

    expect(nextState.jobs?.remove).toContain('__session_timeout__');
    expect(nextState.jobs?.add).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: '__session_timeout__',
          schedule: { at: '30m' },
          message: 'Custom prompt',
          reply: '[@clawmini/session-timeout] Starting a fresh session...',
          nextSessionId: 'mock-uuid',
          jobs: {
            remove: ['__session_timeout__'],
          },
        }),
      ])
    );
  });
});
