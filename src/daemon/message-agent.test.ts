/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleUserMessage } from './message.js';
import * as workspace from '../shared/workspace.js';
import { spawn } from 'node:child_process';
import { runCommandCallback, createAutoFinishMockSpawn } from './message-test-utils.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
vi.mock('../shared/chats.js', () => ({ appendMessage: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./routers.js', () => ({
  executeRouterPipeline: vi.fn().mockImplementation((state) => Promise.resolve(state)),
}));
vi.mock('../shared/workspace.js', () => ({
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

describe('Agent Configuration & Execution CWD', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('merges custom agent settings over defaultAgent', async () => {
    const mockSpawn = createAutoFinishMockSpawn();
    (spawn as any).mockImplementation(mockSpawn);

    vi.mocked(workspace.readChatSettings).mockResolvedValue({ defaultAgent: 'custom-agent' });
    vi.mocked(workspace.readAgentSessionSettings).mockResolvedValue(null);
    vi.mocked(workspace.getAgent).mockResolvedValue({
      commands: {
        new: 'echo custom',
      },
      env: {
        CUSTOM_VAR: 'yes',
      },
    });

    const settings = {
      defaultAgent: {
        commands: { new: 'echo main', append: 'echo append' },
        env: { DEFAULT_VAR: 'yes' },
      },
    };

    await handleUserMessage(
      'chat-custom',
      'hello',
      settings as any,
      '/dir',
      false,
      runCommandCallback
    );

    expect(workspace.getAgent).toHaveBeenCalledWith('custom-agent', '/dir');
    expect(mockSpawn).toHaveBeenCalledWith(
      'echo custom',
      expect.objectContaining({
        env: expect.objectContaining({
          DEFAULT_VAR: 'yes',
          CUSTOM_VAR: 'yes',
        }),
      })
    );
  });

  it('resolves cwd based on custom agent name if directory is not provided', async () => {
    const mockSpawn = createAutoFinishMockSpawn();
    (spawn as any).mockImplementation(mockSpawn);

    vi.mocked(workspace.readChatSettings).mockResolvedValue({ defaultAgent: 'some-agent' });
    vi.mocked(workspace.getAgent).mockResolvedValue({
      commands: { new: 'echo agent-dir' },
    });
    vi.mocked(workspace.getWorkspaceRoot).mockReturnValue('/base/workspace');

    const settings = { defaultAgent: { commands: { new: 'echo main' } } };

    await handleUserMessage(
      'chat-dir-1',
      'hi',
      settings as any,
      '/base/workspace',
      false,
      runCommandCallback
    );

    expect(mockSpawn).toHaveBeenCalledWith(
      'echo agent-dir',
      expect.objectContaining({
        cwd: '/base/workspace/some-agent',
      })
    );
  });

  it('resolves cwd based on agent directory property if provided', async () => {
    const mockSpawn = createAutoFinishMockSpawn();
    (spawn as any).mockImplementation(mockSpawn);

    vi.mocked(workspace.readChatSettings).mockResolvedValue({ defaultAgent: 'custom-dir-agent' });
    vi.mocked(workspace.getAgent).mockResolvedValue({
      directory: 'src/custom-path',
      commands: { new: 'echo my-dir' },
    });
    vi.mocked(workspace.getWorkspaceRoot).mockReturnValue('/base/workspace');

    const settings = { defaultAgent: { commands: { new: 'echo main' } } };

    await handleUserMessage(
      'chat-dir-2',
      'hi',
      settings as any,
      '/base/workspace',
      false,
      runCommandCallback
    );

    expect(mockSpawn).toHaveBeenCalledWith(
      'echo my-dir',
      expect.objectContaining({
        cwd: '/base/workspace/src/custom-path',
      })
    );
  });
});
