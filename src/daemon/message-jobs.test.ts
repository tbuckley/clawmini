/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleUserMessage } from './message.js';
import * as workspace from '../shared/workspace.js';
import { cronManager } from './cron.js';
import { spawn } from 'node:child_process';
import { runCommandCallback, createAutoFinishMockSpawn } from './message-test-utils.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
vi.mock('../shared/chats.js', async (importOriginal) => ({
  ...(await importOriginal()),
  appendMessage: vi.fn().mockResolvedValue(undefined),
}));
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

vi.mock('./cron.js', () => ({
  cronManager: {
    scheduleJob: vi.fn(),
    unscheduleJob: vi.fn(),
  },
}));

describe('Jobs and Session Handling in handleUserMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (spawn as any).mockImplementation(createAutoFinishMockSpawn());
  });

  it('schedules and unschedules jobs returned by routers', async () => {
    const { executeRouterPipeline } = await import('./routers.js');
    vi.mocked(workspace.readChatSettings).mockResolvedValue({ defaultAgent: 'my-agent' });
    vi.mocked(workspace.getAgent).mockResolvedValue({ commands: { new: 'echo start' } } as any);

    vi.mocked(executeRouterPipeline).mockResolvedValueOnce({
      messageId: 'msg-1',
      message: 'test',
      chatId: 'chat1',
      jobs: {
        add: [{ id: 'job1', message: 'test', schedule: { cron: '* * * * *' }, env: {} }],
        remove: ['job2'],
      },
    });

    await handleUserMessage('chat1', 'test message', {} as any, '/dir', false, runCommandCallback);

    expect(cronManager.unscheduleJob).toHaveBeenCalledWith('chat1', 'job2');
    expect(cronManager.scheduleJob).toHaveBeenCalledWith('chat1', {
      id: 'job1',
      message: 'test',
      schedule: { cron: '* * * * *' },
      env: {},
    });
    expect(workspace.writeChatSettings).toHaveBeenCalledWith(
      'chat1',
      expect.objectContaining({
        jobs: expect.arrayContaining([
          { id: 'job1', message: 'test', schedule: { cron: '* * * * *' }, env: {} },
        ]),
      }),
      '/dir'
    );
  });

  it('updates nextSessionId for future messages without altering current execution session', async () => {
    const { executeRouterPipeline } = await import('./routers.js');
    vi.mocked(workspace.readChatSettings).mockResolvedValue({ defaultAgent: 'my-agent' });
    vi.mocked(workspace.getAgent).mockResolvedValue({ commands: { new: 'echo start' } } as any);

    vi.mocked(executeRouterPipeline).mockResolvedValueOnce({
      messageId: 'msg-2',
      message: 'test',
      chatId: 'chat1',
      sessionId: 'current-session-id',
      nextSessionId: 'new-session-id',
    });

    await handleUserMessage('chat1', 'test message', {} as any, '/dir', false, runCommandCallback);

    // Should have updated chatSettings with the nextSessionId
    expect(workspace.writeChatSettings).toHaveBeenCalledWith(
      'chat1',
      expect.objectContaining({
        sessions: { 'my-agent': 'new-session-id' },
      }),
      '/dir'
    );

    // It should STILL use the current session for execution of this turn
    expect(workspace.readAgentSessionSettings).toHaveBeenCalledWith(
      'my-agent',
      'current-session-id',
      '/dir'
    );
  });
});
