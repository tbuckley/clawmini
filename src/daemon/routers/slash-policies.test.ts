/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { slashPolicies } from './slash-policies.js';
import { RequestStore } from '../request-store.js';
import type { PolicyRequest } from '../../shared/policies.js';

vi.mock('../request-store.js');

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
      args: ['arg1'],
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
    expect(result.reply).toContain('- ID: req-1 | Command: test-cmd arg1');
    expect(result.reply).not.toContain('req-2');
  });

  it('should approve a pending request on /approve', async () => {
    const pendingReq: PolicyRequest = {
      id: 'req-1',
      commandName: 'test-cmd',
      args: [],
      fileMappings: {},
      state: 'Pending',
      createdAt: Date.now(),
    };
    mockStore.list.mockResolvedValue([pendingReq]);

    const state = { message: '/approve req-1', chatId: 'chat-1' };
    const result = await slashPolicies(state);

    expect(mockStore.save).toHaveBeenCalledWith({ ...pendingReq, state: 'Approved' });
    expect(result.action).toBe('stop');
    expect(result.reply).toBe('Request req-1 approved.');
  });

  it('should reject a pending request on /reject with reason', async () => {
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

    expect(mockStore.save).toHaveBeenCalledWith({ ...pendingReq, state: 'Rejected' });
    expect(result.action).toBe('stop');
    expect(result.reply).toBe('Request req-1 rejected. Reason: Not allowed');
  });

  it('should not act if request is not found', async () => {
    mockStore.list.mockResolvedValue([]);

    const state = { message: '/approve req-1', chatId: 'chat-1' };
    const result = await slashPolicies(state);

    expect(mockStore.save).not.toHaveBeenCalled();
    expect(result.action).toBe('stop');
    expect(result.reply).toBe('Request not found: req-1');
  });
});
