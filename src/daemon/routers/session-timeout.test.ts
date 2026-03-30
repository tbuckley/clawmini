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
      sessionId: 'session-123',
    };

    const nextState = router(initialState);

    expect(nextState.nextSessionId).toBeUndefined(); // Should not modify current session
    expect(nextState.jobs?.remove).toContain('__session_timeout__session-123');
    expect(nextState.jobs?.add).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: '__session_timeout__session-123',
          schedule: { at: '60m' },
          message:
            'This chat session has ended. Save any important details from it to your memory. When finished, reply with NO_REPLY_NECESSARY.',
          reply: '[@clawmini/session-timeout] Starting a fresh session...',
          nextSessionId: 'mock-uuid',
          session: { type: 'existing', id: 'session-123' },
          jobs: {
            remove: ['__session_timeout__session-123'],
          },
        }),
      ])
    );
  });

  it('works correctly when sessionId is undefined', () => {
    const router = createSessionTimeoutRouter();
    const initialState: RouterState = {
      messageId: 'msg-1',
      message: 'Hello!',
      chatId: 'chat-1',
    };

    const nextState = router(initialState);
    const generatedSessionId = nextState.sessionId;

    expect(generatedSessionId).toBeDefined();
    expect(nextState.jobs?.remove).toContain(`__session_timeout__${generatedSessionId}`);
    expect(nextState.jobs?.add).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: `__session_timeout__${generatedSessionId}`,
          schedule: { at: '60m' },
          message:
            'This chat session has ended. Save any important details from it to your memory. When finished, reply with NO_REPLY_NECESSARY.',
          reply: '[@clawmini/session-timeout] Starting a fresh session...',
          nextSessionId: expect.any(String),
          session: { type: 'existing', id: generatedSessionId },
          env: { __SESSION_TIMEOUT__: 'true' },
          jobs: {
            remove: [`__session_timeout__${generatedSessionId}`],
          },
        }),
      ])
    );
  });

  it('respects custom timeout and prompt configuration', () => {
    const router = createSessionTimeoutRouter({
      timeout: '30m',
      prompt: 'Custom prompt',
    });
    const initialState: RouterState = {
      messageId: 'msg-2',
      message: 'Hello again!',
      chatId: 'chat-1',
      sessionId: 'session-abc',
    };

    const nextState = router(initialState);

    expect(nextState.jobs?.remove).toContain('__session_timeout__session-abc');
    expect(nextState.jobs?.add).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: '__session_timeout__session-abc',
          schedule: { at: '30m' },
          message: 'Custom prompt',
          reply: '[@clawmini/session-timeout] Starting a fresh session...',
          nextSessionId: 'mock-uuid',
          session: { type: 'existing', id: 'session-abc' },
          env: { __SESSION_TIMEOUT__: 'true' },
          jobs: {
            remove: ['__session_timeout__session-abc'],
          },
        }),
      ])
    );
  });

  it('bypasses timeout job creation if currently executing a timeout', () => {
    const router = createSessionTimeoutRouter();
    const initialState: RouterState = {
      messageId: 'msg-3',
      message: 'Timeout prompt',
      chatId: 'chat-1',
      sessionId: 'session-xyz',
      env: { __SESSION_TIMEOUT__: 'true' },
      jobs: { remove: ['__session_timeout__session-xyz'] },
    };

    const nextState = router(initialState);

    expect(nextState).toBe(initialState); // Returns exactly the same state without modifications
  });
});
