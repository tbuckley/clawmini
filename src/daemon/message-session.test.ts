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
  getEnvironmentPath: vi.fn().mockReturnValue(''),
  readEnvironment: vi.fn().mockResolvedValue(null),
}));

describe('Session Resolution & Execution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('executes commands.new if session state file does not exist', async () => {
    const mockSpawn = createAutoFinishMockSpawn();
    (spawn as any).mockImplementation(mockSpawn);

    vi.mocked(workspace.readChatSettings).mockResolvedValue(null);
    vi.mocked(workspace.readAgentSessionSettings).mockResolvedValue(null);

    const settings = { defaultAgent: { commands: { new: 'echo new', append: 'echo append' } } };

    await handleUserMessage(
      'chat1',
      'hello',
      settings as any,
      '/dir-sess-1',
      false,
      runCommandCallback,
      'my-session'
    );

    expect(workspace.readChatSettings).toHaveBeenCalledWith('chat1', '/dir-sess-1');
    expect(workspace.readAgentSessionSettings).toHaveBeenCalledWith(
      'default',
      'my-session',
      '/dir-sess-1'
    );
    expect(mockSpawn).toHaveBeenCalledWith(
      'echo new',
      expect.objectContaining({ cwd: '/dir-sess-1' })
    );
  });

  it('executes commands.append if session state file exists and injects environment', async () => {
    const mockSpawn = createAutoFinishMockSpawn();
    (spawn as any).mockImplementation(mockSpawn);

    vi.mocked(workspace.readChatSettings).mockResolvedValue({
      defaultAgent: 'my-agent',
      sessions: { 'my-agent': 'chat-session' },
    });
    vi.mocked(workspace.readAgentSessionSettings).mockResolvedValue({
      env: { SESSION_ID: '12345' },
    });

    const settings = { defaultAgent: { commands: { new: 'echo new', append: 'echo append' } } };

    await handleUserMessage(
      'chat1',
      'hello',
      settings as any,
      '/dir-sess-3',
      false,
      runCommandCallback
    );

    // Should use inferred session from chatSettings
    expect(workspace.readAgentSessionSettings).toHaveBeenCalledWith(
      'my-agent',
      'chat-session',
      '/dir-sess-3'
    );

    // Should have called spawn with `echo append`
    expect(mockSpawn).toHaveBeenCalledWith(
      'echo append',
      expect.objectContaining({
        env: expect.objectContaining({
          SESSION_ID: '12345',
          CLAW_CLI_MESSAGE: 'hello',
        }),
      })
    );
  });

  it('falls back to commands.new if session exists but commands.append is undefined', async () => {
    const mockSpawn = createAutoFinishMockSpawn();
    (spawn as any).mockImplementation(mockSpawn);

    vi.mocked(workspace.readChatSettings).mockResolvedValue(null);
    vi.mocked(workspace.readAgentSessionSettings).mockResolvedValue({
      env: { SESSION_ID: '12345' },
    });

    const settings = { defaultAgent: { commands: { new: 'echo new' } } };

    await handleUserMessage(
      'chat1',
      'hello',
      settings as any,
      '/dir-sess-2',
      false,
      runCommandCallback,
      'my-session'
    );

    expect(mockSpawn).toHaveBeenCalledWith('echo new', expect.anything());
  });
});
