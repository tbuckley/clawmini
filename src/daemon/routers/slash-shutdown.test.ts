import { describe, it, expect, vi, beforeEach } from 'vitest';
import { slashShutdown } from './slash-shutdown.js';
import { sendControlRequest } from '../../cli/supervisor-control.js';
import type { RouterState } from './types.js';

vi.mock('../../cli/supervisor-control.js');

const baseState: RouterState = {
  message: '',
  messageId: 'mock-msg-id',
  chatId: 'chat-1',
};

describe('slashShutdown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sendControlRequest).mockResolvedValue({ ok: true });
  });

  it('passes through unrelated messages', async () => {
    const state = { ...baseState, message: 'hello' };
    const result = await slashShutdown(state);
    expect(result).toEqual(state);
    expect(sendControlRequest).not.toHaveBeenCalled();
  });

  it('triggers shutdown for /shutdown', async () => {
    const state = { ...baseState, message: '/shutdown' };
    const result = await slashShutdown(state);
    expect(result.action).toBe('stop');
    expect(result.reply).toBe('Shutting down clawmini supervisor...');
    expect(result.message).toBe('');
    expect(sendControlRequest).toHaveBeenCalledWith({ action: 'shutdown' });
  });

  it('does not match /shutdownz', async () => {
    const state = { ...baseState, message: '/shutdownz' };
    const result = await slashShutdown(state);
    expect(result).toEqual(state);
    expect(sendControlRequest).not.toHaveBeenCalled();
  });

  it('returns an error reply when the supervisor request rejects', async () => {
    vi.mocked(sendControlRequest).mockRejectedValueOnce(new Error('socket missing'));
    const state = { ...baseState, message: '/shutdown' };
    const result = await slashShutdown(state);
    expect(result.action).toBe('stop');
    expect(result.reply).toBe('Could not reach supervisor: socket missing.');
  });
});
