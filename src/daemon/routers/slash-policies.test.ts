/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { slashPolicies } from './slash-policies.js';
import { DelegationManager } from '../delegation-manager.js';
import { readPoliciesForPath, getWorkspaceRoot } from '../../shared/workspace.js';
import { resolveAgentDir } from '../api/router-utils.js';
import { executeRequest, truncateLargeOutput, resolveRequestCwd } from '../policy-utils.js';
import { appendMessage } from '../chats.js';
import { executeDirectMessage } from '../message.js';
import type { PolicyDelegation } from '../../shared/delegations.js';

vi.mock('../delegation-store.js');
vi.mock('../delegation-manager.js');
vi.mock('../../shared/workspace.js');
vi.mock('../api/router-utils.js');
vi.mock('../policy-utils.js');
vi.mock('../chats.js');
vi.mock('../message.js');
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return {
    ...actual,
    default: {
      ...actual,
      randomUUID: vi.fn(() => 'mock-uuid'),
    },
    randomUUID: vi.fn(() => 'mock-uuid'),
  };
});

describe('slashPolicies', () => {
  let mockManager: any;

  beforeEach(() => {
    mockManager = {
      list: vi.fn(),
      get: vi.fn(),
      approve: vi.fn(),
      reject: vi.fn(),
      markResolved: vi.fn(),
    };
    vi.mocked(DelegationManager).mockImplementation(function (this: any) {
      this.list = mockManager.list;
      this.get = mockManager.get;
      this.approve = mockManager.approve;
      this.reject = mockManager.reject;
      this.markResolved = mockManager.markResolved;
      return this;
    } as any);

    vi.mocked(appendMessage).mockResolvedValue(undefined);
    vi.mocked(getWorkspaceRoot).mockReturnValue('/mock/workspace');
    vi.mocked(resolveAgentDir).mockResolvedValue('/mock/workspace/agent-1');
    vi.mocked(readPoliciesForPath).mockResolvedValue({
      policies: {
        'test-cmd': {
          command: 'echo',
          args: ['hello'],
        },
      },
    } as any);
    vi.mocked(executeRequest).mockResolvedValue({
      stdout: 'hello world',
      stderr: '',
      exitCode: 0,
      commandStr: 'echo hello world',
    });
    vi.mocked(truncateLargeOutput).mockImplementation(async (stdout, stderr) => ({
      stdout,
      stderr,
    }));
    vi.mocked(resolveRequestCwd).mockResolvedValue('/mock/workspace/agent-1');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should ignore non-matching messages', async () => {
    const state = { message: 'hello world', messageId: 'mock-msg-id', chatId: 'chat-1' };
    const result = await slashPolicies(state as any);
    expect(result).toEqual(state);
  });

  it('should list pending requests on /pending', async () => {
    const pendingReq: PolicyDelegation = {
      id: 'req-1',
      kind: 'policy',
      delivery: 'notify',
      chatId: 'chat-1',
      agentId: 'agent-1',
      createdAt: '2021-01-01T00:00:00Z',
      commandName: 'test-cmd',
      args: ['world'],
      fileMappings: {},
      state: 'pending',
    };
    const approvedReq: PolicyDelegation = { ...pendingReq, id: 'req-2', state: 'running' };
    mockManager.list.mockResolvedValue([pendingReq, approvedReq]);

    const state = { message: '/pending', messageId: 'mock-msg-id', chatId: 'chat-1' };
    const result = await slashPolicies(state as any);

    expect(result.action).toBe('stop');
    expect(result.reply).toContain('Pending Requests (1):');
    expect(result.reply).toContain('- ID: req-1 | Command: test-cmd world');
    expect(mockManager.list).toHaveBeenCalledWith('chat-1');
  });

  describe('validation branches', () => {
    it('should reply "Delegation not found" for /approve with an unknown id', async () => {
      mockManager.get.mockResolvedValue(null);
      const result = await slashPolicies({
        message: '/approve unknown-id',
        messageId: 'mock',
        chatId: 'chat-1',
      } as any);
      expect((result as any).reply).toContain('Delegation not found: unknown-id');
    });

    it('should refuse /approve on an already-approved request', async () => {
      mockManager.get.mockResolvedValue({ state: 'running' } as any);
      const result = await slashPolicies({
        message: '/approve req-1',
        messageId: 'mock',
        chatId: 'chat-1',
      } as any);
      expect((result as any).reply).toContain('Delegation is not pending');
    });
  });

  it('should process /approve, execute command, and notify on success', async () => {
    const pendingReq: PolicyDelegation = {
      id: 'req-1',
      kind: 'policy',
      delivery: 'notify',
      chatId: 'chat-1',
      agentId: 'agent-1',
      createdAt: '2021-01-01T00:00:00Z',
      commandName: 'test-cmd',
      args: ['world'],
      fileMappings: {},
      state: 'pending',
    };
    mockManager.get.mockResolvedValue(pendingReq);

    const result = await slashPolicies({
      message: '/approve req-1',
      chatId: 'chat-1',
      messageId: 'mock',
      agentId: 'agent-1',
      sessionId: 'sess-1',
    } as any);

    expect(result.message).toBe('');
    expect(mockManager.get).toHaveBeenCalledWith('chat-1', 'req-1');
    expect(mockManager.approve).toHaveBeenCalledWith('chat-1', 'req-1');
    expect(executeRequest).toHaveBeenCalledWith(
      pendingReq,
      expect.any(Object),
      '/mock/workspace/agent-1'
    );
    expect(mockManager.markResolved).toHaveBeenCalledWith('chat-1', 'req-1', 'completed', {
      stdout: 'hello world',
      stderr: '',
      exitCode: 0,
    });
    expect(appendMessage).toHaveBeenCalled();
    expect(executeDirectMessage).toHaveBeenCalled();
  });

  it('should process /reject and notify', async () => {
    const pendingReq: PolicyDelegation = {
      id: 'req-1',
      kind: 'policy',
      delivery: 'notify',
      chatId: 'chat-1',
      agentId: 'agent-1',
      createdAt: '2021-01-01T00:00:00Z',
      commandName: 'test-cmd',
      args: ['world'],
      fileMappings: {},
      state: 'pending',
    };
    mockManager.get.mockResolvedValue(pendingReq);

    const result = await slashPolicies({
      message: '/reject req-1 too dangerous',
      chatId: 'chat-1',
      messageId: 'mock',
      agentId: 'agent-1',
      sessionId: 'sess-1',
    } as any);

    expect(result.message).toBe('');
    expect(mockManager.reject).toHaveBeenCalledWith('chat-1', 'req-1', 'too dangerous');
    expect(appendMessage).toHaveBeenCalled();
    expect(executeDirectMessage).toHaveBeenCalled();
  });
});
