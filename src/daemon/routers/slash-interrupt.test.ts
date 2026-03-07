import { describe, it, expect } from 'vitest';
import { slashInterrupt } from './slash-interrupt.js';
import type { RouterState } from './types.js';

describe('slashInterrupt', () => {
  it('should not modify state if message does not start with /interrupt', () => {
    const state: RouterState = { message: 'hello world', chatId: '123' };
    const newState = slashInterrupt(state);
    expect(newState).toEqual(state);
  });

  it('should set action to interrupt and reply if message is /interrupt', () => {
    const state: RouterState = { message: '/interrupt', chatId: '123' };
    const newState = slashInterrupt(state);
    expect(newState.action).toBe('interrupt');
    expect(newState.reply).toBe('Interrupting current task...');
    expect(newState.message).toBe('');
  });

  it('should preserve remainder of message', () => {
    const state: RouterState = { message: '/interrupt extra text', chatId: '123' };
    const newState = slashInterrupt(state);
    expect(newState.action).toBe('interrupt');
    expect(newState.message).toBe('extra text');
  });
});
