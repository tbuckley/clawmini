import { describe, it, expect, vi } from 'vitest';
import { slashNew } from './slash-new.js';

vi.stubGlobal('crypto', { randomUUID: () => 'mock-uuid-1234' });

describe('slashNew router', () => {
  it('should remove /new from the beginning and set a new sessionId', () => {
    const initialState = {
      message: '/new hello world',
      messageId: "mock-msg-id", chatId: 'test-chat',
      sessionId: 'old-session',
    };

    const newState = slashNew(initialState);
    expect(newState.message).toBe('hello world');
    expect(newState.sessionId).toBe('mock-uuid-1234');
    expect(newState.chatId).toBe('test-chat');
  });

  it('should handle /new by itself', () => {
    const initialState = {
      message: '/new',
      messageId: "mock-msg-id", chatId: 'test-chat',
      sessionId: 'old-session',
    };

    const newState = slashNew(initialState);
    expect(newState.message).toBe('');
    expect(newState.sessionId).toBe('mock-uuid-1234');
  });

  it('should do nothing if /new is not at the start', () => {
    const initialState = {
      message: 'hello /new world',
      messageId: "mock-msg-id", chatId: 'test-chat',
      sessionId: 'old-session',
    };

    const newState = slashNew(initialState);
    expect(newState.message).toBe('hello /new world');
    expect(newState.sessionId).toBe('old-session');
  });

  it('should do nothing if the message just starts with /newly', () => {
    const initialState = {
      message: '/newly minted',
      messageId: "mock-msg-id", chatId: 'test-chat',
      sessionId: 'old-session',
    };

    const newState = slashNew(initialState);
    expect(newState.message).toBe('/newly minted');
    expect(newState.sessionId).toBe('old-session');
  });
});
