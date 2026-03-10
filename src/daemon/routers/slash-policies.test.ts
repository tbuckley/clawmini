/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { slashPolicies } from './slash-policies.js';
import { RequestStore } from '../request-store.js';
import { readPolicies } from '../../shared/workspace.js';
import { executeSafe, interpolateArgs } from '../policy-utils.js';
import { appendMessage } from '../chats.js';
import type { PolicyRequest } from '../../shared/policies.js';

vi.mock('../request-store.js');
vi.mock('../../shared/workspace.js');
vi.mock('../policy-utils.js');
vi.mock('../chats.js');
vi.mock('node:crypto', () => ({
  randomUUID: vi.fn(() => 'mock-uuid'),
}));

describe('slashPolicies', () => {
  let mockStore: any;

  beforeEach(() => {
    mockStore = {
      list: vi.fn(),
      load: vi.fn(),
      save: vi.fn(),
    };
    vi.mocked(RequestStore).mockImplementation(function (this: any) {
      this.list = mockStore.list;
      this.load = mockStore.load;
      this.save = mockStore.save;
      return this;
    } as any);

    vi.mocked(appendMessage).mockResolvedValue(undefined);
    vi.mocked(readPolicies).mockResolvedValue({
      policies: {
        'test-cmd': {
          command: 'echo',
          args: ['hello'],
        },
      },
    });
    vi.mocked(interpolateArgs).mockReturnValue(['hello', 'world']);
    vi.mocked(executeSafe).mockResolvedValue({
      stdout: 'hello world',
      stderr: '',
      exitCode: 0,
    });
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
    const pendingReq: PolicyRequest = {
      id: 'req-1',
      commandName: 'test-cmd',
      args: ['world'],
      fileMappings: {},
      state: 'Pending',
      createdAt: Date.now(),
      chatId: 'chat-1',
      agentId: 'agent-1',
    };
    const approvedReq: PolicyRequest = { ...pendingReq, id: 'req-2', state: 'Approved' };
    mockStore.list.mockResolvedValue([pendingReq, approvedReq]);

    const state = { message: '/pending', messageId: 'mock-msg-id', chatId: 'chat-1' };
    const result = await slashPolicies(state);

    expect(result.action).toBe('stop');
    expect(result.reply).toContain('Pending Requests (1):');
    expect(result.reply).toContain('- ID: req-1 | Command: test-cmd world');
    expect(result.reply).not.toContain('req-2');
  });

  it('should approve a pending request on /approve, execute it, and inject feedback', async () => {
    const pendingReq: PolicyRequest = {
      id: 'req-1',
      commandName: 'test-cmd',
      args: ['world'],
      fileMappings: {},
      state: 'Pending',
      createdAt: Date.now(),
      chatId: 'chat-1',
      agentId: 'agent-1',
    };
    mockStore.load.mockResolvedValue(pendingReq);

    const state = { message: '/approve req-1', messageId: 'mock-msg-id', chatId: 'chat-1' };
    const result = await slashPolicies(state);

    expect(mockStore.save).toHaveBeenCalledWith({ ...pendingReq, state: 'Approved' });
    expect(executeSafe).toHaveBeenCalledWith('echo', ['hello', 'world'], expect.any(Object));
    expect(appendMessage).toHaveBeenCalledWith(
      'chat-1',
      expect.objectContaining({
        role: 'log',
        content: 'Request req-1 approved and executed.',
        command: 'echo hello world',
        stdout: 'hello world',
        exitCode: 0,
      })
    );
    expect(result.action).toBeUndefined();
    expect(result.message).toContain('Request req-1 approved.');
    expect(result.message).toContain('STDOUT:\nhello world');
  });

  it('should reject a pending request on /reject with reason and inject feedback', async () => {
    const pendingReq: PolicyRequest = {
      id: 'req-1',
      commandName: 'test-cmd',
      args: [],
      fileMappings: {},
      state: 'Pending',
      createdAt: Date.now(),
      chatId: 'chat-1',
      agentId: 'agent-1',
    };
    mockStore.load.mockResolvedValue(pendingReq);

    const state = {
      message: '/reject req-1 Not allowed',
      messageId: 'mock-msg-id',
      chatId: 'chat-1',
    };
    const result = await slashPolicies(state);

    expect(mockStore.save).toHaveBeenCalledWith({
      ...pendingReq,
      state: 'Rejected',
      rejectionReason: 'Not allowed',
    });
    expect(appendMessage).toHaveBeenCalledWith(
      'chat-1',
      expect.objectContaining({
        role: 'log',
        content: 'Request req-1 rejected. Reason: Not allowed',
        command: 'policy-request-reject req-1',
        exitCode: 1,
      })
    );
    expect(result.action).toBeUndefined();
    expect(result.message).toBe('Request req-1 rejected. Reason: Not allowed');
  });

  it('should not act if request is not found', async () => {
    mockStore.load.mockResolvedValue(null);

    const state = { message: '/approve req-1', messageId: 'mock-msg-id', chatId: 'chat-1' };
    const result = await slashPolicies(state);

    expect(mockStore.save).not.toHaveBeenCalled();
    expect(appendMessage).not.toHaveBeenCalled();
    expect(result.action).toBeUndefined();
    expect(result.message).toBe('');
    expect(result.reply).toBe('Request not found: req-1');
  });
});
