import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DelegationManager } from './delegation-manager.js';
import { DelegationStore } from './delegation-store.js';
import type { Delegation } from '../shared/delegations.js';

vi.mock('./events.js', () => ({ emitDelegationResolved: vi.fn() }));
import { emitDelegationResolved } from './events.js';

describe('DelegationManager', () => {
  let store: DelegationStore;
  let manager: DelegationManager;
  let mockStoreData: Record<string, Record<string, Delegation>>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockStoreData = {};

    store = {
      save: vi.fn(async (del: Delegation) => {
        if (!mockStoreData[del.chatId]) mockStoreData[del.chatId] = {};
        const chatData = mockStoreData[del.chatId];
        if (chatData) chatData[del.id] = { ...del };
      }),
      load: vi.fn(async (chatId: string, id: string) => {
        return mockStoreData[chatId]?.[id] || null;
      }),
      list: vi.fn(async (chatId: string) => {
        return Object.values(mockStoreData[chatId] || {});
      }),
      delete: vi.fn(async (chatId: string, id: string) => {
        if (mockStoreData[chatId]) {
          delete mockStoreData[chatId][id];
        }
      }),
      createUniqueId: vi.fn(async () => 'abc'),
    } as unknown as DelegationStore;

    manager = new DelegationManager(store);
  });

  describe('createPolicy', () => {
    it('should create a policy delegation with pending state', async () => {
      const del = await manager.createPolicy({
        chatId: 'chat-1',
        agentId: 'agent-1',
        commandName: 'test',
        args: ['arg1'],
        fileMappings: {},
        delivery: 'notify',
      });

      expect(del.kind).toBe('policy');
      expect(del.state).toBe('pending');
      expect(del.delivery).toBe('notify');
      expect(del.id).toBe('abc');
      expect(store.save).toHaveBeenCalledWith(del);
    });
  });

  describe('createSubagent', () => {
    it('should create a subagent delegation with pending state', async () => {
      const del = await manager.createSubagent({
        chatId: 'chat-1',
        agentId: 'agent-1',
        targetAgentId: 'sub-1',
        prompt: 'hello',
        delivery: 'manual',
      });

      expect(del.kind).toBe('subagent');
      expect(del.state).toBe('pending');
      expect(del.delivery).toBe('manual');
      expect(del.sessionId).toBeDefined();
      expect(del.prompt).toBe('hello');
      expect(store.save).toHaveBeenCalledWith(del);
    });
  });

  describe('sendToSubagent', () => {
    it('should update prompt and set state to running', async () => {
      await manager.createSubagent({
        chatId: 'chat-1',
        agentId: 'agent-1',
        targetAgentId: 'sub-1',
        prompt: 'hello',
        delivery: 'manual',
      });

      const updated = await manager.sendToSubagent({
        chatId: 'chat-1',
        id: 'abc',
        prompt: 'world',
      });

      expect(updated.prompt).toBe('world');
      expect(updated.state).toBe('running');
    });

    it('should throw if not a subagent', async () => {
      await manager.createPolicy({
        chatId: 'chat-1',
        agentId: 'agent-1',
        commandName: 'test',
        args: [],
        fileMappings: {},
        delivery: 'notify',
      });

      await expect(
        manager.sendToSubagent({ chatId: 'chat-1', id: 'abc', prompt: 'world' })
      ).rejects.toThrow('is not a subagent');
    });
  });

  describe('approve', () => {
    it('should transition pending to running', async () => {
      await manager.createPolicy({
        chatId: 'chat-1',
        agentId: 'agent-1',
        commandName: 'test',
        args: [],
        fileMappings: {},
        delivery: 'notify',
      });

      const approved = await manager.approve('chat-1', 'abc');
      expect(approved.state).toBe('running');
    });

    it('should throw if not pending', async () => {
      await manager.createPolicy({
        chatId: 'chat-1',
        agentId: 'agent-1',
        commandName: 'test',
        args: [],
        fileMappings: {},
        delivery: 'notify',
      });

      await manager.approve('chat-1', 'abc');

      await expect(manager.approve('chat-1', 'abc')).rejects.toThrow(
        'cannot be approved from state running'
      );
    });
  });

  describe('reject', () => {
    it('should transition pending to rejected and set rejectionReason', async () => {
      await manager.createPolicy({
        chatId: 'chat-1',
        agentId: 'agent-1',
        commandName: 'test',
        args: [],
        fileMappings: {},
        delivery: 'notify',
      });

      const rejected = await manager.reject('chat-1', 'abc', 'no thanks');
      expect(rejected.state).toBe('rejected');
      expect(rejected.rejectionReason).toBe('no thanks');
      expect(rejected.resolvedAt).toBeDefined();
      expect(emitDelegationResolved).toHaveBeenCalledWith({
        chatId: 'chat-1',
        delegationId: 'abc',
        state: 'rejected',
      });
    });
  });

  describe('markResolved', () => {
    it('should transition to completed', async () => {
      await manager.createPolicy({
        chatId: 'chat-1',
        agentId: 'agent-1',
        commandName: 'test',
        args: [],
        fileMappings: {},
        delivery: 'notify',
      });

      const resolved = await manager.markResolved('chat-1', 'abc', 'completed', {
        stdout: 'out',
        stderr: '',
        exitCode: 0,
      });
      expect(resolved.state).toBe('completed');
      expect(resolved.resolvedAt).toBeDefined();
      if (resolved.kind === 'policy') {
        expect(resolved.executionResult?.stdout).toBe('out');
      }

      expect(emitDelegationResolved).toHaveBeenCalledWith({
        chatId: 'chat-1',
        delegationId: 'abc',
        state: 'completed',
      });
    });
  });

  describe('get, list, delete', () => {
    it('should delegate to store', async () => {
      await manager.createPolicy({
        chatId: 'chat-1',
        agentId: 'agent-1',
        commandName: 'test',
        args: [],
        fileMappings: {},
        delivery: 'notify',
      });

      const list = await manager.list('chat-1');
      expect(list.length).toBe(1);

      const get = await manager.get('chat-1', 'abc');
      expect(get?.id).toBe('abc');

      await manager.delete('chat-1', 'abc');
      const list2 = await manager.list('chat-1');
      expect(list2.length).toBe(0);
    });
  });
});
