import { describe, it, expect, vi, beforeEach } from 'vitest';
import { slashUpgrade } from './slash-upgrade.js';
import { detectInstall } from '../../cli/install-detection.js';
import { sendControlRequest } from '../../cli/supervisor-control.js';
import { enqueuePendingReply } from '../pending-replies.js';
import type { RouterState } from './types.js';

vi.mock('../../cli/install-detection.js');
vi.mock('../../cli/supervisor-control.js');
vi.mock('../pending-replies.js');

const baseState: RouterState = {
  message: '',
  messageId: 'mock-msg-id',
  chatId: 'chat-1',
};

describe('slashUpgrade', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sendControlRequest).mockResolvedValue({ ok: true });
    vi.mocked(enqueuePendingReply).mockReturnValue(undefined);
  });

  it('passes through unrelated messages', () => {
    const state = { ...baseState, message: 'hello' };
    const result = slashUpgrade(state);
    expect(result).toEqual(state);
    expect(sendControlRequest).not.toHaveBeenCalled();
  });

  it('triggers upgrade when installed via npm', () => {
    vi.mocked(detectInstall).mockReturnValue({
      isNpmGlobal: true,
      entryRealPath: '/usr/local/lib/node_modules/clawmini/dist/cli.js',
      npmRootRealPath: '/usr/local/lib/node_modules',
    });
    const state = { ...baseState, message: '/upgrade' };
    const result = slashUpgrade(state);
    expect(result.action).toBe('stop');
    expect(result.reply).toContain('Upgrading clawmini');
    expect(result.message).toBe('');
    expect(sendControlRequest).toHaveBeenCalledWith({ action: 'upgrade' });
    expect(enqueuePendingReply).toHaveBeenCalledWith({
      chatId: 'chat-1',
      kind: 'upgrade-complete',
      messageId: 'mock-msg-id',
    });
  });

  it('refuses upgrade when not installed via npm (e.g. npm link)', () => {
    vi.mocked(detectInstall).mockReturnValue({
      isNpmGlobal: false,
      entryRealPath: '/Users/me/projects/clawmini/dist/cli/index.mjs',
      npmRootRealPath: '/usr/local/lib/node_modules',
    });
    const state = { ...baseState, message: '/upgrade' };
    const result = slashUpgrade(state);
    expect(result.action).toBe('stop');
    expect(result.reply).toContain('not installed via');
    expect(result.reply).toContain('/Users/me/projects/clawmini/dist/cli/index.mjs');
    expect(sendControlRequest).not.toHaveBeenCalled();
    expect(enqueuePendingReply).not.toHaveBeenCalled();
  });
});
