import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeSubagent } from './subagent-utils.js';
import * as workspace from '../../shared/workspace.js';
import * as message from '../message.js';
import { taskScheduler } from '../agent/task-scheduler.js';
import { randomUUID } from 'node:crypto';

vi.mock('../../shared/workspace.js', () => ({
  updateChatSettings: vi.fn(),
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
