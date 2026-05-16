/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { slashPolicies } from './slash-policies.js';
import { delegationManager } from '../delegation-manager.js';
import { readPoliciesForPath, getWorkspaceRoot } from '../../shared/workspace.js';
import { resolveAgentDir } from '../api/router-utils.js';
import { truncateLargeOutput } from '../policy-utils.js';
import { executePolicyDelegation } from '../policy-request-service.js';
import { appendMessage } from '../chats.js';
import { executeDirectMessage } from '../message.js';
import type { PolicyDelegation } from '../../shared/delegations.js';

vi.mock('../delegation-manager.js', () => ({
  delegationManager: {
    get: vi.fn(),
    list: vi.fn(),
    approve: vi.fn(),
    reject: vi.fn(),
    markResolved: vi.fn(),
  },
}));
vi.mock('../../shared/workspace.js');
vi.mock('../api/router-utils.js');
vi.mock('../policy-utils.js');
vi.mock('../policy-request-service.js');
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

const makeDelegation = (overrides: Partial<PolicyDelegation> = {}): PolicyDelegation => ({
  id: 'req-1',
  kind: 'policy',
  state: 'pending',
  delivery: 'notify',
  chatId: 'chat-1',
  agentId: 'agent-1',
  createdAt: new Date().toISOString(),
  commandName: 'test-cmd',
  args: ['world'],
  fileMappings: {},
  ...overrides,
});

describe('slashPolicies', () => {
  beforeEach(() => {
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
    });
    vi.mocked(executePolicyDelegation).mockResolvedValue({
      stdout: 'hello world',
      stderr: '',
      exitCode: 0,
      commandStr: 'echo hello world',
    });
    vi.mocked(truncateLargeOutput).mockImplementation(async (stdout, stderr) => ({
      stdout,
      stderr,
    }));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should ignore non-matching messages', async () => {
    const state = { message: 'hello world', messageId: 'mock-msg-id', chatId: 'chat-1' };
    const result = await slashPolicies(state);
    expect(result).toEqual(state);
  });

  it('should list pending requests on /pending', async () => {
    const pendingReq = makeDelegation({ id: 'req-1', state: 'pending' });
    vi.mocked(delegationManager.list).mockResolvedValue([pendingReq]);

    const state = { message: '/pending', messageId: 'mock-msg-id', chatId: 'chat-1' };
    const result = await slashPolicies(state);

    expect(delegationManager.list).toHaveBeenCalledWith({
      chatId: 'chat-1',
      kind: 'policy',
      state: 'pending',
    });
    expect(result.action).toBe('stop');
    expect(result.reply).toContain('Pending Requests (1):');
    expect(result.reply).toContain('- ID: req-1 | Command: test-cmd world');
  });

  it('should approve a pending request on /approve, execute it, and inject feedback', async () => {
    const pendingReq = makeDelegation();
    vi.mocked(delegationManager.get).mockResolvedValue(pendingReq);

    const state = { message: '/approve req-1', messageId: 'mock-msg-id', chatId: 'chat-1' };
    const result = await slashPolicies(state);

    expect(delegationManager.approve).toHaveBeenCalledWith('req-1', 'user');
    expect(executePolicyDelegation).toHaveBeenCalledWith(pendingReq, expect.any(Object), undefined);
    expect(delegationManager.markResolved).toHaveBeenCalledWith('req-1', {
      state: 'completed',
      executionResult: { stdout: 'hello world', stderr: '', exitCode: 0 },
    });
    expect(appendMessage).toHaveBeenCalledWith(
      'chat-1',
      expect.objectContaining({
        role: 'system',
        event: 'policy_approved',
        displayRole: 'agent',
        content: expect.stringContaining('Request req-1 (`test-cmd`) approved.'),
      })
    );
    expect(executeDirectMessage).toHaveBeenCalled();
    expect(result.action).toBeUndefined();
    expect(result.message).toBe('');
  });

  it('should reject a pending request on /reject with reason and inject feedback', async () => {
    const pendingReq = makeDelegation({ args: [] });
    vi.mocked(delegationManager.get).mockResolvedValue(pendingReq);

    const state = {
      message: '/reject req-1 Not allowed',
      messageId: 'mock-msg-id',
      chatId: 'chat-1',
    };
    const result = await slashPolicies(state);

    expect(delegationManager.reject).toHaveBeenCalledWith('req-1', 'Not allowed');
    expect(delegationManager.markResolved).not.toHaveBeenCalled();
    expect(appendMessage).toHaveBeenCalledTimes(1);
    expect(appendMessage).toHaveBeenCalledWith(
      'chat-1',
      expect.objectContaining({
        role: 'system',
        event: 'policy_rejected',
        displayRole: 'agent',
        content: 'Request req-1 (`test-cmd`) rejected. Reason: Not allowed',
      })
    );
    expect(executeDirectMessage).toHaveBeenCalled();
    expect(result.action).toBeUndefined();
    expect(result.message).toBe('');
  });

  it('forwards externalRef into the post-approval executeDirectMessage call', async () => {
    const pendingReq = makeDelegation({ args: [] });
    vi.mocked(delegationManager.get).mockResolvedValue(pendingReq);

    const state = {
      message: '/approve req-1',
      messageId: 'mock-msg-id',
      chatId: 'chat-1',
      externalRef: 'discord-card-msg-7',
    };
    await slashPolicies(state);

    expect(executeDirectMessage).toHaveBeenCalledWith(
      'chat-1',
      expect.objectContaining({ externalRef: 'discord-card-msg-7' }),
      undefined,
      expect.any(String),
      true,
      expect.any(String),
      undefined,
      'policy_approved',
      'user'
    );
  });

  it('forwards externalRef into the post-rejection executeDirectMessage call', async () => {
    const pendingReq = makeDelegation({ args: [] });
    vi.mocked(delegationManager.get).mockResolvedValue(pendingReq);

    const state = {
      message: '/reject req-1 nope',
      messageId: 'mock-msg-id',
      chatId: 'chat-1',
      externalRef: 'discord-card-msg-9',
    };
    await slashPolicies(state);

    expect(executeDirectMessage).toHaveBeenCalledWith(
      'chat-1',
      expect.objectContaining({ externalRef: 'discord-card-msg-9' }),
      undefined,
      expect.any(String),
      true,
      expect.any(String),
      undefined,
      'policy_rejected',
      'user'
    );
  });

  it('should not act if request is not found', async () => {
    vi.mocked(delegationManager.get).mockResolvedValue(null);

    const state = { message: '/approve req-1', messageId: 'mock-msg-id', chatId: 'chat-1' };
    const result = await slashPolicies(state);

    expect(delegationManager.approve).not.toHaveBeenCalled();
    expect(appendMessage).not.toHaveBeenCalled();
    expect(result.action).toBeUndefined();
    expect(result.message).toBe('');
    expect(result.reply).toBe('Request not found: req-1');
  });
});
