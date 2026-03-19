/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleUserMessage } from './message.js';
import * as chats from '../shared/chats.js';
import * as routers from './routers.js';

vi.mock('../shared/chats.js', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  appendMessage: vi.fn().mockResolvedValue(undefined),
  getChatsDir: vi.fn().mockResolvedValue('/mock/chats/dir'),
}));

vi.mock('./routers.js', () => ({
  executeRouterPipeline: vi.fn().mockImplementation((state) => Promise.resolve(state)),
}));

vi.mock('../shared/workspace.js', () => ({
  readChatSettings: vi.fn().mockResolvedValue(null),
  writeChatSettings: vi.fn().mockResolvedValue(undefined),
  readAgentSessionSettings: vi.fn().mockResolvedValue(null),
  writeAgentSessionSettings: vi.fn().mockResolvedValue(undefined),
  getAgent: vi.fn().mockResolvedValue({
    commands: { new: 'echo hello' },
  }),
  getWorkspaceRoot: vi.fn().mockImplementation((cwd) => cwd),
  getActiveEnvironmentInfo: vi.fn().mockResolvedValue(null),
}));

describe('Subagent Execution and Router Bypassing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('bypasses routers and invokes executeDirectMessage when using a subagent chat ID', async () => {
    const runCommand = vi.fn().mockResolvedValue({ stdout: 'done', stderr: '', exitCode: 0 });

    const mockSettings: any = { defaultAgent: { commands: { new: 'echo hello' } } };

    await handleUserMessage(
      'parent:subagents:uuid1',
      'do some work',
      mockSettings,
      '/workspace',
      true, // noWait
      runCommand
    );

    expect(routers.executeRouterPipeline).not.toHaveBeenCalled();
    // Wait for async task to complete since noWait is true
    await new Promise((r) => setTimeout(r, 10));

    expect(runCommand).toHaveBeenCalled();
  });

  it('appends a completion message to the parent chat on success', async () => {
    const runCommand = vi
      .fn()
      .mockResolvedValue({ stdout: 'task output', stderr: '', exitCode: 0 });

    const mockSettings: any = { defaultAgent: { commands: { new: 'echo hello' } } };

    await handleUserMessage(
      'parent:subagents:uuid2',
      'hello subagent',
      mockSettings,
      '/workspace',
      true,
      runCommand
    );
    // Wait for background queue task to finish
    await new Promise((r) => setTimeout(r, 10));

    const calls = vi.mocked(chats.appendMessage).mock.calls;

    // executeDirectMessage will append a log message with the subagent completion
    const completionCall = calls.find(
      (call) =>
        call[0] === 'parent' &&
        call[1].role === 'log' &&
        (call[1] as any).command === 'subagent-completion' &&
        call[1].content.includes('completed its task')
    );

    expect(completionCall).toBeDefined();
    expect((completionCall![1] as any).content).toContain('completed its task');
    expect((completionCall![1] as any).content).toContain('task output');
  });

  it('appends an error completion message to the parent chat on failure', async () => {
    const runCommand = vi
      .fn()
      .mockResolvedValue({ stdout: '', stderr: 'task failed', exitCode: 1 });

    const mockSettings: any = { defaultAgent: { commands: { new: 'echo hello' } } };

    await handleUserMessage(
      'parent:subagents:uuid3',
      'fail subagent',
      mockSettings,
      '/workspace',
      true,
      runCommand
    );

    // Wait for background queue task to finish
    await new Promise((r) => setTimeout(r, 10));

    const calls = vi.mocked(chats.appendMessage).mock.calls;

    const completionCall = calls.find(
      (call) =>
        call[0] === 'parent' &&
        call[1].role === 'log' &&
        (call[1] as any).command === 'subagent-completion' &&
        call[1].content.includes('encountered an error in')
    );

    expect(completionCall).toBeDefined();
    expect((completionCall![1] as any).content).toContain('encountered an error in');
    expect((completionCall![1] as any).content).toContain('task failed');
  });
});
