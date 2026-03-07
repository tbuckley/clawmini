import { describe, it, expect } from 'vitest';
import { slashStop } from './slash-stop.js';
import type { RouterState } from './types.js';

describe('slashStop', () => {
  it('should not modify state if message does not start with /stop', () => {
    const state: RouterState = { message: 'hello world', chatId: '123' };
    const newState = slashStop(state);
    expect(newState).toEqual(state);
  });

  it('should set action to stop and reply if message is /stop', () => {
    const state: RouterState = { message: '/stop', chatId: '123' };
    const newState = slashStop(state);
    expect(newState.action).toBe('stop');
    expect(newState.reply).toBe('Stopping current task...');
    expect(newState.message).toBe('');
  });

  it('should preserve remainder of message', () => {
    const state: RouterState = { message: '/stop extra text', chatId: '123' };
    const newState = slashStop(state);
    expect(newState.action).toBe('stop');
    expect(newState.message).toBe('extra text');
  });
});
