import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeSubagent, resolveSubagentEnvironments } from './subagent-utils.js';
import * as workspace from '../../shared/workspace.js';
import { taskScheduler } from '../agent/task-scheduler.js';
import * as routerUtils from './router-utils.js';

vi.mock('./router-utils.js', () => ({
  resolveAgentDir: vi.fn(),
}));

vi.mock('../../shared/workspace.js', () => ({
  updateChatSettings: vi.fn(),
  getActiveEnvironmentName: vi.fn(),
}));

vi.mock('../message.js', () => ({
  executeDirectMessage: vi.fn(),
}));

vi.mock('../agent/chat-logger.js', () => ({
  createChatLogger: vi.fn(() => ({
    findLastMessage: vi.fn().mockResolvedValue(null),
    logSystemEvent: vi.fn(),
  })),
}));

vi.mock('../agent/task-scheduler.js', () => ({
  taskScheduler: {
    hasTasks: vi.fn(),
  },
}));

describe('executeSubagent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should not mark subagent as completed if there are still pending tasks in the queue', async () => {
    vi.mocked(taskScheduler.hasTasks).mockReturnValue(true);

    await executeSubagent(
      'chat-1',
      'sub-1',
      'agent-1',
      'session-1',
      'hello',
      false,
      { agentId: 'parent-agent' },
      '/workspace'
    );

    // Should NOT call updateChatSettings to set status to completed
    expect(workspace.updateChatSettings).not.toHaveBeenCalled();
  });
});

describe('resolveSubagentEnvironments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves environments correctly when matching environments exist', async () => {
    vi.mocked(routerUtils.resolveAgentDir).mockImplementation(async (id) => `/mock/dir/${id}`);
    vi.mocked(workspace.getActiveEnvironmentName).mockImplementation(async (dir) => {
      if (dir === '/mock/dir/agent-a') return 'env-a';
      if (dir === '/mock/dir/agent-b') return 'env-b';
      return null;
    });

    const result = await resolveSubagentEnvironments('agent-a', 'agent-b', '/mock/root');

    expect(result).toEqual({ sourceEnv: 'env-a', targetEnv: 'env-b' });
    expect(routerUtils.resolveAgentDir).toHaveBeenCalledWith('agent-a', '/mock/root');
    expect(routerUtils.resolveAgentDir).toHaveBeenCalledWith('agent-b', '/mock/root');
  });

  it('defaults to "host" when getActiveEnvironmentName returns null', async () => {
    vi.mocked(routerUtils.resolveAgentDir).mockResolvedValue('/mock/dir/some-agent');
    vi.mocked(workspace.getActiveEnvironmentName).mockResolvedValue(null);

    const result = await resolveSubagentEnvironments('source', 'target', '/mock/root');

    expect(result).toEqual({ sourceEnv: 'host', targetEnv: 'host' });
  });

  it('defaults to "host" when getActiveEnvironmentName returns undefined', async () => {
    vi.mocked(routerUtils.resolveAgentDir).mockResolvedValue('/mock/dir/some-agent');
    vi.mocked(workspace.getActiveEnvironmentName).mockResolvedValue(undefined as unknown as string);

    const result = await resolveSubagentEnvironments('source', 'target', '/mock/root');

    expect(result).toEqual({ sourceEnv: 'host', targetEnv: 'host' });
  });
});
