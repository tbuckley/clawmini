import { describe, it, expect, vi, beforeEach } from 'vitest';
import { slashRestart } from './slash-restart.js';
import { sendControlRequest } from '../../cli/supervisor-control.js';
import type { RouterState } from './types.js';

vi.mock('../../cli/supervisor-control.js');

const baseState: RouterState = {
  message: '',
  messageId: 'mock-msg-id',
  chatId: 'chat-1',
};

describe('slashRestart', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sendControlRequest).mockResolvedValue({ ok: true });
  });

  it('passes through unrelated messages', async () => {
    const state = { ...baseState, message: 'hello' };
    const result = await slashRestart(state);
    expect(result).toEqual(state);
    expect(sendControlRequest).not.toHaveBeenCalled();
  });

  it('forwards chatId/messageId to the supervisor for /restart', async () => {
    const state = { ...baseState, message: '/restart' };
    const result = await slashRestart(state);
    expect(result.action).toBe('stop');
    expect(result.reply).toBe('Restarting clawmini daemon...');
    expect(result.message).toBe('');
    expect(sendControlRequest).toHaveBeenCalledWith({
      action: 'restart',
      chatId: 'chat-1',
      messageId: 'mock-msg-id',
    });
  });

  it('matches /restart with trailing whitespace', async () => {
    const state = { ...baseState, message: '/restart   ' };
    const result = await slashRestart(state);
    expect(result.action).toBe('stop');
    expect(sendControlRequest).toHaveBeenCalled();
  });

  it('does not match /restartfoo', async () => {
    const state = { ...baseState, message: '/restartfoo' };
    const result = await slashRestart(state);
    expect(result).toEqual(state);
    expect(sendControlRequest).not.toHaveBeenCalled();
  });

  it('returns an error reply when the supervisor request rejects', async () => {
    vi.mocked(sendControlRequest).mockRejectedValueOnce(new Error('socket missing'));
    const state = { ...baseState, message: '/restart' };
    const result = await slashRestart(state);
    expect(result.action).toBe('stop');
    expect(result.reply).toBe('Could not reach supervisor: socket missing.');
  });

  it('returns an error reply when the supervisor reports !ok', async () => {
    vi.mocked(sendControlRequest).mockResolvedValueOnce({ ok: false, error: 'busy' });
    const state = { ...baseState, message: '/restart' };
    const result = await slashRestart(state);
    expect(result.action).toBe('stop');
    expect(result.reply).toBe('Restart aborted: busy.');
  });
});
