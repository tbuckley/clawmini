import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeSubagent } from './subagent-utils.js';
import * as workspace from '../../shared/workspace.js';
import { taskScheduler } from '../agent/task-scheduler.js';
import * as turnRegistry from '../agent/turn-registry.js';

vi.mock('../../shared/workspace.js', () => ({
  updateChatSettings: vi.fn(),
  readChatSettings: vi.fn().mockResolvedValue({}),
}));

vi.mock('../routers.js', () => ({
  executeRouterPipeline: vi.fn().mockImplementation((state) => Promise.resolve(state)),
  resolveRouters: vi.fn((routers) => routers),
}));

vi.mock('../message.js', () => ({
  executeDirectMessage: vi.fn(),
  applyRouterStateUpdates: vi.fn(),
}));

vi.mock('../agent/chat-logger.js', () => ({
  createChatLogger: vi.fn(() => ({
    findLastMessage: vi.fn().mockResolvedValue(null),
    logSystemEvent: vi.fn(),
    logSubagentStatus: vi.fn(),
  })),
}));

vi.mock('../agent/task-scheduler.js', () => ({
  taskScheduler: {
    hasTasks: vi.fn(),
  },
}));

vi.mock('../agent/turn-registry.js', () => ({
  incrementSubagent: vi.fn(),
  decrementSubagent: vi.fn(),
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

  it('should not increment the parent turn counter — that is the caller-s responsibility', async () => {
    vi.mocked(taskScheduler.hasTasks).mockReturnValue(false);

    await executeSubagent(
      'chat-1',
      'sub-1',
      'agent-1',
      'session-1',
      'hello',
      false,
      { agentId: 'parent-agent', turnId: 'turn-1' },
      '/workspace'
    );

    expect(turnRegistry.incrementSubagent).not.toHaveBeenCalled();
  });

  it('should decrement the parent turn counter exactly once on early return', async () => {
    vi.mocked(taskScheduler.hasTasks).mockReturnValue(true);

    await executeSubagent(
      'chat-1',
      'sub-1',
      'agent-1',
      'session-1',
      'hello',
      false,
      { agentId: 'parent-agent', turnId: 'turn-1' },
      '/workspace'
    );

    expect(turnRegistry.decrementSubagent).toHaveBeenCalledTimes(1);
    expect(turnRegistry.decrementSubagent).toHaveBeenCalledWith('turn-1');
  });

  it('should decrement the parent turn counter exactly once on normal completion', async () => {
    vi.mocked(taskScheduler.hasTasks).mockReturnValue(false);

    await executeSubagent(
      'chat-1',
      'sub-1',
      'agent-1',
      'session-1',
      'hello',
      false,
      { agentId: 'parent-agent', turnId: 'turn-1' },
      '/workspace'
    );

    expect(turnRegistry.decrementSubagent).toHaveBeenCalledTimes(1);
    expect(turnRegistry.decrementSubagent).toHaveBeenCalledWith('turn-1');
  });
});
