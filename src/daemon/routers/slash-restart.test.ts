import { describe, it, expect, vi, beforeEach } from 'vitest';
import { slashRestart } from './slash-restart.js';
import { sendControlRequest } from '../../cli/supervisor-control.js';
import { enqueuePendingReply } from '../pending-replies.js';
import type { RouterState } from './types.js';

vi.mock('../../cli/supervisor-control.js');
vi.mock('../pending-replies.js');

const baseState: RouterState = {
  message: '',
  messageId: 'mock-msg-id',
  chatId: 'chat-1',
};

describe('slashRestart', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sendControlRequest).mockResolvedValue({ ok: true });
    vi.mocked(enqueuePendingReply).mockReturnValue(undefined);
  });

  it('passes through unrelated messages', () => {
    const state = { ...baseState, message: 'hello' };
    const result = slashRestart(state);
    expect(result).toEqual(state);
    expect(sendControlRequest).not.toHaveBeenCalled();
    expect(enqueuePendingReply).not.toHaveBeenCalled();
  });

  it('triggers restart and enqueues reply for /restart', () => {
    const state = { ...baseState, message: '/restart' };
    const result = slashRestart(state);
    expect(result.action).toBe('stop');
    expect(result.reply).toBe('Restarting clawmini daemon...');
    expect(result.message).toBe('');
    expect(sendControlRequest).toHaveBeenCalledWith({ action: 'restart' });
    expect(enqueuePendingReply).toHaveBeenCalledWith({
      chatId: 'chat-1',
      kind: 'restart-complete',
      messageId: 'mock-msg-id',
    });
  });

  it('matches /restart with trailing whitespace', () => {
    const state = { ...baseState, message: '/restart   ' };
    const result = slashRestart(state);
    expect(result.action).toBe('stop');
    expect(sendControlRequest).toHaveBeenCalled();
  });

  it('does not match /restartfoo', () => {
    const state = { ...baseState, message: '/restartfoo' };
    const result = slashRestart(state);
    expect(result).toEqual(state);
    expect(sendControlRequest).not.toHaveBeenCalled();
  });
});
