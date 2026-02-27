import { describe, it, expect, vi, beforeEach } from 'vitest';
import { slashCommand } from './slash-command.js';
import * as workspace from '../../shared/workspace.js';
import * as fsUtils from '../../shared/utils/fs.js';
import fs from 'node:fs/promises';

vi.mock('node:fs/promises');
vi.mock('../../shared/workspace.js');
vi.mock('../../shared/utils/fs.js');

describe('slashCommand router', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(workspace.getClawminiDir).mockReturnValue('/mock/workspace/.clawmini');
  });

  it('should replace a matching slash command with .md file contents', async () => {
    vi.mocked(fsUtils.pathIsInsideDir).mockReturnValue(true);
    vi.mocked(fs.readFile).mockResolvedValue('Hello from command!\n');

    const initialState = {
      message: 'Please run /test for me',
      chatId: 'test-chat',
    };

    const newState = await slashCommand(initialState);

    expect(fsUtils.pathIsInsideDir).toHaveBeenCalledWith(
      '/mock/workspace/.clawmini/commands/test',
      '/mock/workspace/.clawmini/commands'
    );
    expect(fs.readFile).toHaveBeenCalledWith('/mock/workspace/.clawmini/commands/test.md', 'utf8');
    expect(newState.message).toBe('Please run Hello from command! for me');
  });

  it('should fallback to .txt file contents if .md is not found', async () => {
    vi.mocked(fsUtils.pathIsInsideDir).mockReturnValue(true);
    vi.mocked(fs.readFile).mockImplementation(async (path) => {
      if (path === '/mock/workspace/.clawmini/commands/test.txt') return 'Hello from txt command!\n';
      throw new Error('Not found');
    });

    const initialState = {
      message: 'Please run /test for me',
      chatId: 'test-chat',
    };

    const newState = await slashCommand(initialState);

    expect(fs.readFile).toHaveBeenCalledWith('/mock/workspace/.clawmini/commands/test.md', 'utf8');
    expect(fs.readFile).toHaveBeenCalledWith('/mock/workspace/.clawmini/commands/test.txt', 'utf8');
    expect(newState.message).toBe('Please run Hello from txt command! for me');
  });

  it('should handle multiple slash commands', async () => {
    vi.mocked(fsUtils.pathIsInsideDir).mockReturnValue(true);
    vi.mocked(fs.readFile).mockImplementation(async (path) => {
      if (path === '/mock/workspace/.clawmini/commands/cmd1.md') return 'first';
      if (path === '/mock/workspace/.clawmini/commands/cmd2.txt') return 'second';
      throw new Error('Not found');
    });

    const initialState = {
      message: '/cmd1 and /cmd2',
      chatId: 'test-chat',
    };

    const newState = await slashCommand(initialState);
    expect(newState.message).toBe('first and second');
  });

  it('should leave the message unchanged if command file is not found', async () => {
    vi.mocked(fsUtils.pathIsInsideDir).mockReturnValue(true);
    vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));

    const initialState = {
      message: 'Run /missing please',
      chatId: 'test-chat',
    };

    const newState = await slashCommand(initialState);
    expect(newState.message).toBe('Run /missing please');
  });

  it('should prevent path traversal attacks', async () => {
    vi.mocked(fsUtils.pathIsInsideDir).mockReturnValue(false); // Simulate resolving outside

    const initialState = {
      message: 'Run /.. please',
      chatId: 'test-chat',
    };

    const newState = await slashCommand(initialState);

    expect(fsUtils.pathIsInsideDir).toHaveBeenCalled();
    expect(fs.readFile).not.toHaveBeenCalled();
    expect(newState.message).toBe('Run /.. please');
  });

  it('should support colons in command names', async () => {
    vi.mocked(fsUtils.pathIsInsideDir).mockReturnValue(true);
    vi.mocked(fs.readFile).mockImplementation(async (path) => {
      if (path === '/mock/workspace/.clawmini/commands/foo:bar.md') return 'colon command result';
      throw new Error('Not found');
    });

    const initialState = {
      message: '/foo:bar is cool',
      chatId: 'test-chat',
    };

    const newState = await slashCommand(initialState);

    expect(fs.readFile).toHaveBeenCalledWith('/mock/workspace/.clawmini/commands/foo:bar.md', 'utf8');
    expect(newState.message).toBe('colon command result is cool');
  });

  it('should not match commands embedded in words', async () => {
    const initialState = {
      message: 'https://example.com/foo /bar',
      chatId: 'test-chat',
    };

    vi.mocked(fsUtils.pathIsInsideDir).mockReturnValue(true);
    vi.mocked(fs.readFile).mockImplementation(async (path) => {
      if (path === '/mock/workspace/.clawmini/commands/bar.md') return 'bar result';
      throw new Error('Not found');
    });

    const newState = await slashCommand(initialState);
    expect(fs.readFile).toHaveBeenCalledWith('/mock/workspace/.clawmini/commands/bar.md', 'utf8');
    expect(newState.message).toBe('https://example.com/foo bar result');
  });
});