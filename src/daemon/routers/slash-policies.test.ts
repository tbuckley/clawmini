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
      save: vi.fn(),
    };
    vi.mocked(RequestStore).mockImplementation(function (this: any) {
      this.list = mockStore.list;
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
    const state = { message: 'hello world', chatId: 'chat-1' };
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
    };
    const approvedReq: PolicyRequest = { ...pendingReq, id: 'req-2', state: 'Approved' };
    mockStore.list.mockResolvedValue([pendingReq, approvedReq]);

    const state = { message: '/pending', chatId: 'chat-1' };
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
    };
    mockStore.list.mockResolvedValue([pendingReq]);

    const state = { message: '/approve req-1', chatId: 'chat-1' };
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
    expect(result.action).toBe('stop');
    expect(result.reply).toBe('Request req-1 approved.');
  });

  it('should reject a pending request on /reject with reason and inject feedback', async () => {
    const pendingReq: PolicyRequest = {
      id: 'req-1',
      commandName: 'test-cmd',
      args: [],
      fileMappings: {},
      state: 'Pending',
      createdAt: Date.now(),
    };
    mockStore.list.mockResolvedValue([pendingReq]);

    const state = { message: '/reject req-1 Not allowed', chatId: 'chat-1' };
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
    expect(result.action).toBe('stop');
    expect(result.reply).toBe('Request req-1 rejected. Reason: Not allowed');
  });

  it('should not act if request is not found', async () => {
    mockStore.list.mockResolvedValue([]);

    const state = { message: '/approve req-1', chatId: 'chat-1' };
    const result = await slashPolicies(state);

    expect(mockStore.save).not.toHaveBeenCalled();
    expect(appendMessage).not.toHaveBeenCalled();
    expect(result.action).toBe('stop');
    expect(result.reply).toBe('Request not found: req-1');
  });
});
