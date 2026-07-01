import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { executeSubagent } from './subagent-utils.js';
import * as workspace from '../../shared/workspace.js';
import { taskScheduler } from '../agent/task-scheduler.js';
import * as turnRegistry from '../agent/turn-registry.js';
import { DelegationStore } from '../delegation-store.js';
import { delegationManager } from '../delegation-manager.js';

vi.mock('../../shared/workspace.js', () => ({
  readChatSettings: vi.fn().mockResolvedValue({}),
  getWorkspaceRoot: vi.fn(),
  getClawminiDir: vi.fn(),
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

const TEST_DIR = path.join(process.cwd(), '.test-subagent-utils');

describe('executeSubagent', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(workspace.getClawminiDir).mockReturnValue(TEST_DIR);
    vi.mocked(workspace.getWorkspaceRoot).mockReturnValue(TEST_DIR);
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(TEST_DIR, { recursive: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (delegationManager as any)._store = new DelegationStore(TEST_DIR);
  });

  afterEach(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (delegationManager as any)._store = null;
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  it('should not mark subagent as completed if there are still pending tasks in the queue', async () => {
    vi.mocked(taskScheduler.hasTasks).mockReturnValue(true);

    // Seed a running delegation so the post-execute lookup has something
    // to inspect; with `hasTasks=true` it must *not* be marked completed.
    await delegationManager.createSubagent({
      chatId: 'chat-1',
      agentId: 'parent-agent',
      targetAgentId: 'agent-1',
      sessionId: 'session-1',
      prompt: 'hello',
      autoApprove: true,
      id: 'sub-1',
    });

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

    const rec = await delegationManager.get('sub-1', 'chat-1');
    expect(rec?.state).toBe('running');
  });

  it('should not increment the parent turn counter — that is the caller-s responsibility', async () => {
    vi.mocked(taskScheduler.hasTasks).mockReturnValue(false);

    await delegationManager.createSubagent({
      chatId: 'chat-1',
      agentId: 'parent-agent',
      targetAgentId: 'agent-1',
      sessionId: 'session-1',
      prompt: 'hello',
      autoApprove: true,
      id: 'sub-1',
    });

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

    await delegationManager.createSubagent({
      chatId: 'chat-1',
      agentId: 'parent-agent',
      targetAgentId: 'agent-1',
      sessionId: 'session-1',
      prompt: 'hello',
      autoApprove: true,
      id: 'sub-1',
    });

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

    await delegationManager.createSubagent({
      chatId: 'chat-1',
      agentId: 'parent-agent',
      targetAgentId: 'agent-1',
      sessionId: 'session-1',
      prompt: 'hello',
      autoApprove: true,
      id: 'sub-1',
    });

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
