/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleUserMessage } from './message.js';
import * as chats from '../shared/chats.js';
import { runCommand } from './utils/spawn.js';

vi.mock('./utils/spawn.js', () => ({ runCommand: vi.fn() }));

vi.mock('../shared/chats.js', () => ({
  appendMessage: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./routers.js', () => ({
  executeRouterPipeline: vi.fn().mockImplementation((state) =>
    Promise.resolve({
      ...state,
      reply: state.message.includes('NO_REPLY_NECESSARY') ? 'NO_REPLY_NECESSARY' : undefined,
    })
  ),
}));
vi.mock('../shared/workspace.js', () => ({
  resolveAgentWorkDir: vi
    .fn()
    .mockImplementation((id, dir, root) => (dir ? `${root}/${dir}` : `${root}/${id}`)),

  readChatSettings: vi.fn().mockResolvedValue(null),
  writeChatSettings: vi.fn().mockResolvedValue(undefined),
  readAgentSessionSettings: vi.fn().mockResolvedValue(null),
  writeAgentSessionSettings: vi.fn().mockResolvedValue(undefined),
  getAgent: vi.fn().mockResolvedValue(null),
  getWorkspaceRoot: vi.fn().mockImplementation((cwd) => cwd),
  getActiveEnvironmentName: vi.fn().mockResolvedValue(null),
  getActiveEnvironmentInfo: vi.fn().mockResolvedValue(null),
  getEnvironmentPath: vi.fn().mockReturnValue(''),
  readEnvironment: vi.fn().mockResolvedValue(null),
}));

describe('Message Verbosity (NO_REPLY_NECESSARY)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sets level to verbose for logMsg if stdout includes NO_REPLY_NECESSARY', async () => {
    vi.mocked(runCommand).mockResolvedValue({
      stdout: 'Some output with NO_REPLY_NECESSARY inside',
      stderr: '',
      exitCode: 0,
    });

    const settings = {
      defaultAgent: {
        commands: { new: 'echo test' },
      },
    };

    await handleUserMessage('chat-verbose-1', 'hello', settings as any, '/dir', false);

    expect(chats.appendMessage).toHaveBeenCalled();
    const calls = vi.mocked(chats.appendMessage).mock.calls;
    // The last appendMessage should be the logMsg
    const logMsgCall = calls.find(
      (call) => (call[1] as any).role === 'log' && (call[1] as any).command === 'echo test'
    );
    expect(logMsgCall).toBeDefined();
    expect((logMsgCall![1] as any).level).toBe('verbose');
  });

  it('does not set level to verbose for logMsg if stdout does not include NO_REPLY_NECESSARY', async () => {
    vi.mocked(runCommand).mockResolvedValue({
      stdout: 'Normal output',
      stderr: '',
      exitCode: 0,
    });

    const settings = {
      defaultAgent: {
        commands: { new: 'echo test' },
      },
    };

    await handleUserMessage('chat-verbose-2', 'hello', settings as any, '/dir', false);

    const calls = vi.mocked(chats.appendMessage).mock.calls;
    const logMsgCall = calls.find(
      (call) => (call[1] as any).role === 'log' && (call[1] as any).command === 'echo test'
    );
    expect(logMsgCall).toBeDefined();
    expect((logMsgCall![1] as any).level).toBeUndefined();
  });

  it('sets level to verbose for routerLogMsg if state.reply includes NO_REPLY_NECESSARY', async () => {
    vi.mocked(runCommand).mockResolvedValue({
      stdout: 'Normal output',
      stderr: '',
      exitCode: 0,
    });

    const settings = {
      defaultAgent: {
        commands: { new: 'echo test' },
      },
    };

    // message includes NO_REPLY_NECESSARY to trigger our mocked router setting it as reply
    await handleUserMessage(
      'chat-verbose-3',
      'trigger NO_REPLY_NECESSARY via mock router',
      settings as any,
      '/dir',
      false
    );

    const calls = vi.mocked(chats.appendMessage).mock.calls;
    const routerLogMsgCall = calls.find(
      (call) => (call[1] as any).role === 'log' && (call[1] as any).source === 'router'
    );
    expect(routerLogMsgCall).toBeDefined();
    expect((routerLogMsgCall![1] as any).level).toBe('verbose');
  });
});
