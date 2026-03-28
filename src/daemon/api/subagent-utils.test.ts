import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  executeSubagent,
  resolveSubagentEnvironments,
  waitForPolicyRequest,
} from './subagent-utils.js';
import * as workspace from '../../shared/workspace.js';
import { taskScheduler } from '../agent/task-scheduler.js';
import * as routerUtils from './router-utils.js';
import { daemonEvents, DAEMON_EVENT_MESSAGE_APPENDED } from '../events.js';
import type { PolicyRequest } from '../../shared/policies.js';

const mockLoad = vi.fn();

vi.mock('../request-store.js', () => ({
  RequestStore: class {
    load = mockLoad;
  },
}));

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
    logSubagentStatus: vi.fn(),
  })),
}));

vi.mock('../agent/task-scheduler.js', () => ({
  taskScheduler: {
    hasTasks: vi.fn(),
  },
}));

describe('waitForPolicyRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should resolve immediately if request is already approved', async () => {
    mockLoad.mockResolvedValue({ state: 'Approved' } as unknown as PolicyRequest);

    await expect(waitForPolicyRequest('req-1', '/workspace')).resolves.toBeUndefined();
  });

  it('should reject immediately if request is already rejected', async () => {
    mockLoad.mockResolvedValue({ state: 'Rejected' } as unknown as PolicyRequest);

    await expect(waitForPolicyRequest('req-1', '/workspace')).rejects.toThrow(
      /Policy request rejected/
    );
  });

  it('should resolve when policy_approved event is emitted', async () => {
    // First it's pending, then after event it's approved
    let isApproved = false;
    mockLoad.mockImplementation(async () => {
      return { state: isApproved ? 'Approved' : 'Pending' } as unknown as PolicyRequest;
    });

    const promise = waitForPolicyRequest('req-1', '/workspace');

    // Simulate event
    isApproved = true;
    daemonEvents.emit(DAEMON_EVENT_MESSAGE_APPENDED, {
      message: { role: 'system', event: 'policy_approved' },
    });

    await expect(promise).resolves.toBeUndefined();
  });

  it('should reject when policy_rejected event is emitted', async () => {
    // First it's pending, then after event it's rejected
    let isRejected = false;
    mockLoad.mockImplementation(async () => {
      return { state: isRejected ? 'Rejected' : 'Pending' } as unknown as PolicyRequest;
    });

    const promise = waitForPolicyRequest('req-1', '/workspace');

    // Simulate event
    isRejected = true;
    daemonEvents.emit(DAEMON_EVENT_MESSAGE_APPENDED, {
      message: { role: 'system', event: 'policy_rejected' },
    });

    await expect(promise).rejects.toThrow(/Policy request rejected/);
  });
});

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
