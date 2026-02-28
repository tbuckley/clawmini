/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleUserMessage } from './message.js';
import * as workspace from '../shared/workspace.js';
import * as chats from '../shared/chats.js';
import { executeRouterPipeline } from './routers.js';
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
}));

describe('Router Pipeline Execution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('applies updated state properties to the queue', async () => {
    const mockSpawn = createAutoFinishMockSpawn();
    (spawn as any).mockImplementation(mockSpawn);

    vi.mocked(workspace.readChatSettings).mockResolvedValue({
      defaultAgent: 'old-agent',
      routers: ['@clawmini/slash-new'],
    });
    vi.mocked(workspace.readAgentSessionSettings).mockResolvedValue(null);
    vi.mocked(workspace.getAgent).mockResolvedValue(null);

    vi.mocked(executeRouterPipeline).mockResolvedValueOnce({
      message: 'hello new message',
      chatId: 'chat-router',
      agentId: 'new-agent',
      sessionId: 'new-session',
      env: { ROUTER_VAR: 'router-val' },
      reply: 'I routed this for you.',
    });

    const settings = {
      defaultAgent: {
        commands: { new: 'echo main' },
      },
    };

    await handleUserMessage(
      'chat-router',
      'hello world',
      settings as any,
      '/dir-router',
      false,
      runCommandCallback
    );

    // Verify userMsg is saved with original message
    expect(chats.appendMessage).toHaveBeenCalledWith(
      'chat-router',
      expect.objectContaining({
        role: 'user',
        content: 'hello world',
      })
    );

    // Verify router reply is saved before agent runs
    expect(chats.appendMessage).toHaveBeenCalledWith(
      'chat-router',
      expect.objectContaining({
        role: 'log',
        source: 'router',
        content: 'I routed this for you.',
      })
    );

    // Verify resolveSessionState is called with finalAgentId and finalSessionId
    expect(workspace.readAgentSessionSettings).toHaveBeenCalledWith(
      'new-agent',
      'new-session',
      '/dir-router'
    );

    // Verify execution used updated env
    expect(mockSpawn).toHaveBeenCalledWith(
      'echo main',
      expect.objectContaining({
        env: expect.objectContaining({
          ROUTER_VAR: 'router-val',
          CLAW_CLI_MESSAGE: 'hello new message',
        }),
      })
    );
  });
});
