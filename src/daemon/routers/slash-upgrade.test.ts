import { describe, it, expect, vi, beforeEach } from 'vitest';
import { slashUpgrade } from './slash-upgrade.js';
import { detectInstall } from '../../cli/install-detection.js';
import { sendControlRequest } from '../../cli/supervisor-control.js';
import type { RouterState } from './types.js';

vi.mock('../../cli/install-detection.js');
vi.mock('../../cli/supervisor-control.js');

const baseState: RouterState = {
  message: '',
  messageId: 'mock-msg-id',
  chatId: 'chat-1',
};

const npmInstall = {
  isNpmGlobal: true,
  entryRealPath: '/usr/local/lib/node_modules/clawmini/dist/cli.js',
  npmRootRealPath: '/usr/local/lib/node_modules',
};

describe('slashUpgrade', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sendControlRequest).mockResolvedValue({ ok: true });
    vi.mocked(detectInstall).mockReturnValue(npmInstall);
  });

  it('passes through unrelated messages', async () => {
    const state = { ...baseState, message: 'hello' };
    const result = await slashUpgrade(state);
    expect(result).toEqual(state);
    expect(sendControlRequest).not.toHaveBeenCalled();
  });

  it('refuses upgrade when not installed via npm (e.g. npm link)', async () => {
    vi.mocked(detectInstall).mockReturnValueOnce({
      isNpmGlobal: false,
      entryRealPath: '/Users/me/projects/clawmini/dist/cli/index.mjs',
      npmRootRealPath: '/usr/local/lib/node_modules',
    });
    const state = { ...baseState, message: '/upgrade latest' };
    const result = await slashUpgrade(state);
    expect(result.action).toBe('stop');
    expect(result.reply).toContain('not installed via');
    expect(result.reply).toContain('/Users/me/projects/clawmini/dist/cli/index.mjs');
    expect(sendControlRequest).not.toHaveBeenCalled();
  });

  it('shows usage hint for bare /upgrade (does NOT trigger an install)', async () => {
    const state = { ...baseState, message: '/upgrade' };
    const result = await slashUpgrade(state);
    expect(result.action).toBe('stop');
    expect(result.reply).toContain('/upgrade requires an explicit target');
    expect(result.reply).toContain('/upgrade latest');
    expect(sendControlRequest).not.toHaveBeenCalled();
  });

  it('forwards version, chatId, and messageId to the supervisor', async () => {
    const state = { ...baseState, message: '/upgrade 1.2.3' };
    const result = await slashUpgrade(state);
    expect(result.action).toBe('stop');
    expect(result.reply).toBe('Upgrading clawmini to 1.2.3... services will restart shortly.');
    expect(sendControlRequest).toHaveBeenCalledWith({
      action: 'upgrade',
      version: '1.2.3',
      chatId: 'chat-1',
      messageId: 'mock-msg-id',
    });
  });

  it('accepts the literal "latest"', async () => {
    const state = { ...baseState, message: '/upgrade latest' };
    const result = await slashUpgrade(state);
    expect(result.action).toBe('stop');
    expect(result.reply).toContain('Upgrading clawmini to latest');
    expect(sendControlRequest).toHaveBeenCalledWith({
      action: 'upgrade',
      version: 'latest',
      chatId: 'chat-1',
      messageId: 'mock-msg-id',
    });
  });

  it('rejects multi-token arguments to avoid smuggling extra npm flags', async () => {
    const state = { ...baseState, message: '/upgrade 1.2.3 --registry=evil' };
    const result = await slashUpgrade(state);
    expect(result.action).toBe('stop');
    expect(result.reply).toBe('Usage: /upgrade <version>');
    expect(sendControlRequest).not.toHaveBeenCalled();
  });

  it('rejects shell-meta versions even as a single token', async () => {
    const state = { ...baseState, message: '/upgrade $(rm)' };
    const result = await slashUpgrade(state);
    expect(result.action).toBe('stop');
    expect(result.reply).toContain('Invalid version');
    expect(sendControlRequest).not.toHaveBeenCalled();
  });

  it('returns an error reply when the supervisor reports !ok', async () => {
    vi.mocked(sendControlRequest).mockResolvedValueOnce({ ok: false, error: 'busy' });
    const state = { ...baseState, message: '/upgrade latest' };
    const result = await slashUpgrade(state);
    expect(result.action).toBe('stop');
    expect(result.reply).toBe('Upgrade aborted: busy.');
  });

  it('returns an error reply when the supervisor request rejects', async () => {
    vi.mocked(sendControlRequest).mockRejectedValueOnce(new Error('socket missing'));
    const state = { ...baseState, message: '/upgrade latest' };
    const result = await slashUpgrade(state);
    expect(result.action).toBe('stop');
    expect(result.reply).toBe('Could not reach supervisor: socket missing.');
  });
});
