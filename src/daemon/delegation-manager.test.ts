import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { DelegationManager } from './delegation-manager.js';
import { DelegationStore } from './delegation-store.js';
import { daemonEvents, DAEMON_EVENT_DELEGATION_RESOLVED } from './events.js';
import type { DelegationResolvedEvent } from './events.js';
import * as workspace from '../shared/workspace.js';

vi.mock('../shared/workspace.js', () => ({
  getClawminiDir: vi.fn(),
  getWorkspaceRoot: vi.fn(),
}));

const TEST_DIR = path.join(process.cwd(), '.test-delegation-manager');

describe('DelegationManager', () => {
  let manager: DelegationManager;
  let store: DelegationStore;

  beforeEach(async () => {
    vi.mocked(workspace.getClawminiDir).mockReturnValue(TEST_DIR);
    vi.mocked(workspace.getWorkspaceRoot).mockReturnValue(process.cwd());
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(TEST_DIR, { recursive: true });
    store = new DelegationStore();
    manager = new DelegationManager(store);
  });

  afterEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    // Detach any listeners attached during a test to keep tests isolated.
    daemonEvents.removeAllListeners(DAEMON_EVENT_DELEGATION_RESOLVED);
    vi.restoreAllMocks();
  });

  describe('createPolicy', () => {
    it('persists a record in state=pending when autoApprove is false/omitted', async () => {
      const created = await manager.createPolicy({
        chatId: 'chat-1',
        agentId: 'agent-1',
        commandName: 'echo',
        args: ['hi'],
        fileMappings: {},
      });
      expect(created.kind).toBe('policy');
      expect(created.state).toBe('pending');
      expect(created.delivery).toBe('notify');
      expect(created.id).toMatch(/^[0-9a-z]{3,}$/);
      expect(created.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

      const loaded = await store.load('chat-1', created.id);
      expect(loaded).toEqual(created);
    });

    it('persists a record in state=running when autoApprove is true', async () => {
      const created = await manager.createPolicy({
        chatId: 'chat-1',
        agentId: 'agent-1',
        commandName: 'echo',
        args: ['hi'],
        fileMappings: {},
        autoApprove: true,
      });
      expect(created.state).toBe('running');
      const loaded = await store.load('chat-1', created.id);
      expect(loaded?.state).toBe('running');
    });

    it('honors caller-provided delivery + parentId + cwd', async () => {
      const created = await manager.createPolicy({
        chatId: 'chat-1',
        agentId: 'agent-1',
        commandName: 'echo',
        args: ['hi'],
        fileMappings: { 'file.txt': '/snap/file.txt' },
        cwd: '/work',
        parentId: 'parent-sub',
        delivery: 'manual',
      });
      expect(created.delivery).toBe('manual');
      expect(created.parentId).toBe('parent-sub');
      expect(created.cwd).toBe('/work');
      expect(created.fileMappings).toEqual({ 'file.txt': '/snap/file.txt' });
    });
  });

  describe('createSubagent', () => {
    it('persists a record in state=pending when autoApprove is false/omitted', async () => {
      const created = await manager.createSubagent({
        chatId: 'chat-1',
        agentId: 'agent-1',
        targetAgentId: 'helper',
        sessionId: 'sess-1',
        prompt: 'do the thing',
      });
      expect(created.kind).toBe('subagent');
      expect(created.state).toBe('pending');
      expect(created.delivery).toBe('notify');
      expect(created.id).toMatch(/^[0-9a-z]{3,}$/);
      expect(created.targetAgentId).toBe('helper');
      expect(created.sessionId).toBe('sess-1');
      expect(created.prompt).toBe('do the thing');

      const loaded = await store.load('chat-1', created.id);
      expect(loaded).toEqual(created);
    });

    it('persists a record in state=running when autoApprove is true', async () => {
      const created = await manager.createSubagent({
        chatId: 'chat-1',
        agentId: 'agent-1',
        targetAgentId: 'helper',
        sessionId: 'sess-1',
        prompt: 'do',
        autoApprove: true,
        delivery: 'manual',
      });
      expect(created.state).toBe('running');
      expect(created.delivery).toBe('manual');
    });
  });

  describe('approve', () => {
    it('transitions pending → running for a policy', async () => {
      const created = await manager.createPolicy({
        chatId: 'chat-1',
        agentId: 'agent-1',
        commandName: 'echo',
        args: [],
        fileMappings: {},
      });
      await manager.approve(created.id, 'user');
      const loaded = await store.load('chat-1', created.id);
      expect(loaded?.state).toBe('running');
    });

    it('transitions pending → running for a subagent', async () => {
      const created = await manager.createSubagent({
        chatId: 'chat-1',
        agentId: 'agent-1',
        targetAgentId: 'helper',
        sessionId: 'sess-1',
        prompt: 'do',
      });
      await manager.approve(created.id, 'auto');
      const loaded = await store.load('chat-1', created.id);
      expect(loaded?.state).toBe('running');
    });

    it("throws when the delegation isn't pending", async () => {
      const created = await manager.createPolicy({
        chatId: 'chat-1',
        agentId: 'agent-1',
        commandName: 'echo',
        args: [],
        fileMappings: {},
        autoApprove: true,
      });
      await expect(manager.approve(created.id, 'user')).rejects.toThrow(/expected state 'pending'/);
    });

    it('throws when the id is unknown', async () => {
      await expect(manager.approve('zzz', 'user')).rejects.toThrow(/not found/);
    });
  });

  describe('reject', () => {
    it('transitions pending → rejected and stamps rejectionReason', async () => {
      const created = await manager.createPolicy({
        chatId: 'chat-1',
        agentId: 'agent-1',
        commandName: 'rm',
        args: ['-rf', '/'],
        fileMappings: {},
      });

      const events: DelegationResolvedEvent[] = [];
      daemonEvents.on(DAEMON_EVENT_DELEGATION_RESOLVED, (ev: DelegationResolvedEvent) => {
        events.push(ev);
      });

      await manager.reject(created.id, 'too dangerous');
      const loaded = await store.load('chat-1', created.id);
      expect(loaded?.state).toBe('rejected');
      expect(loaded?.rejectionReason).toBe('too dangerous');
      expect(loaded?.resolvedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

      expect(events).toHaveLength(1);
      expect(events[0]?.chatId).toBe('chat-1');
      expect(events[0]?.delegation.id).toBe(created.id);
      expect(events[0]?.delegation.state).toBe('rejected');
    });

    it("throws when the delegation isn't pending", async () => {
      const created = await manager.createPolicy({
        chatId: 'chat-1',
        agentId: 'agent-1',
        commandName: 'echo',
        args: [],
        fileMappings: {},
        autoApprove: true,
      });
      await expect(manager.reject(created.id, 'nope')).rejects.toThrow(/expected state 'pending'/);
    });
  });

  describe('markResolved', () => {
    it('transitions running → completed for a policy, sets executionResult + resolvedAt, emits the event once', async () => {
      const created = await manager.createPolicy({
        chatId: 'chat-1',
        agentId: 'agent-1',
        commandName: 'echo',
        args: ['hi'],
        fileMappings: {},
        autoApprove: true,
      });

      const events: DelegationResolvedEvent[] = [];
      daemonEvents.on(DAEMON_EVENT_DELEGATION_RESOLVED, (ev: DelegationResolvedEvent) => {
        events.push(ev);
      });

      await manager.markResolved(created.id, {
        state: 'completed',
        executionResult: { stdout: 'hi\n', stderr: '', exitCode: 0 },
      });

      const loaded = await store.load('chat-1', created.id);
      expect(loaded?.state).toBe('completed');
      expect(loaded?.resolvedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      if (loaded?.kind !== 'policy') throw new Error('expected policy');
      expect(loaded.executionResult).toEqual({ stdout: 'hi\n', stderr: '', exitCode: 0 });

      expect(events).toHaveLength(1);
      expect(events[0]?.delegation.id).toBe(created.id);
      expect(events[0]?.delegation.state).toBe('completed');
    });

    it('transitions running → completed for a subagent (no executionResult)', async () => {
      const created = await manager.createSubagent({
        chatId: 'chat-1',
        agentId: 'agent-1',
        targetAgentId: 'helper',
        sessionId: 'sess-1',
        prompt: 'do',
        autoApprove: true,
      });
      await manager.markResolved(created.id, { state: 'completed' });
      const loaded = await store.load('chat-1', created.id);
      expect(loaded?.state).toBe('completed');
      expect(loaded?.resolvedAt).toBeTruthy();
    });

    it('transitions running → failed and records the reason', async () => {
      const created = await manager.createSubagent({
        chatId: 'chat-1',
        agentId: 'agent-1',
        targetAgentId: 'helper',
        sessionId: 'sess-1',
        prompt: 'do',
        autoApprove: true,
      });

      const events: DelegationResolvedEvent[] = [];
      daemonEvents.on(DAEMON_EVENT_DELEGATION_RESOLVED, (ev: DelegationResolvedEvent) => {
        events.push(ev);
      });

      await manager.markResolved(created.id, { state: 'failed', reason: 'process exited 1' });
      const loaded = await store.load('chat-1', created.id);
      expect(loaded?.state).toBe('failed');
      expect(loaded?.rejectionReason).toBe('process exited 1');
      expect(loaded?.resolvedAt).toBeTruthy();
      expect(events).toHaveLength(1);
      expect(events[0]?.delegation.state).toBe('failed');
    });

    it("throws when the delegation isn't running", async () => {
      const created = await manager.createPolicy({
        chatId: 'chat-1',
        agentId: 'agent-1',
        commandName: 'echo',
        args: [],
        fileMappings: {},
      });
      await expect(manager.markResolved(created.id, { state: 'completed' })).rejects.toThrow(
        /expected state 'running'/
      );
    });
  });

  describe('observation', () => {
    it('get() returns the persisted record', async () => {
      const created = await manager.createPolicy({
        chatId: 'chat-1',
        agentId: 'agent-1',
        commandName: 'echo',
        args: [],
        fileMappings: {},
      });
      const got = await manager.get(created.id, 'chat-1');
      expect(got).toEqual(created);
    });

    it('list() filters by chat, kind, and state', async () => {
      const p = await manager.createPolicy({
        chatId: 'chat-1',
        agentId: 'agent-1',
        commandName: 'echo',
        args: [],
        fileMappings: {},
      });
      const s1 = await manager.createSubagent({
        chatId: 'chat-1',
        agentId: 'agent-1',
        targetAgentId: 'helper',
        sessionId: 'sess-1',
        prompt: 'do',
      });
      const s2 = await manager.createSubagent({
        chatId: 'chat-1',
        agentId: 'agent-1',
        targetAgentId: 'helper',
        sessionId: 'sess-1',
        prompt: 'do',
        autoApprove: true,
      });

      const subs = await manager.list({ chatId: 'chat-1', kind: 'subagent' });
      expect(subs.map((d) => d.id).sort()).toEqual([s1.id, s2.id].sort());

      const pending = await manager.list({ chatId: 'chat-1', state: 'pending' });
      expect(pending.map((d) => d.id).sort()).toEqual([p.id, s1.id].sort());

      const running = await manager.list({ chatId: 'chat-1', state: 'running' });
      expect(running.map((d) => d.id)).toEqual([s2.id]);
    });

    it('list() requires chatId', async () => {
      await expect(manager.list({})).rejects.toThrow(/requires filter\.chatId/);
    });

    it('delete() removes the record', async () => {
      const created = await manager.createPolicy({
        chatId: 'chat-1',
        agentId: 'agent-1',
        commandName: 'echo',
        args: [],
        fileMappings: {},
      });
      await manager.delete(created.id, 'chat-1');
      expect(await manager.get(created.id, 'chat-1')).toBeNull();
    });
  });

  describe('stubs', () => {
    it('sendToSubagent throws not-implemented', async () => {
      await expect(manager.sendToSubagent('abc', 'hi')).rejects.toThrow(/not-implemented/);
    });

    it('wait throws not-implemented', async () => {
      await expect(
        manager.wait({
          ids: ['abc'],
          mode: 'any',
          return: 'sync',
          chatId: 'chat-1',
          sessionId: 'sess-1',
        })
      ).rejects.toThrow(/not-implemented/);
    });

    it('unsubscribe throws not-implemented', async () => {
      await expect(manager.unsubscribe('sub-1')).rejects.toThrow(/not-implemented/);
    });
  });

  describe('wipeAll', () => {
    it('empties the tree', async () => {
      await manager.createPolicy({
        chatId: 'chat-1',
        agentId: 'agent-1',
        commandName: 'echo',
        args: [],
        fileMappings: {},
      });
      await manager.createSubagent({
        chatId: 'chat-2',
        agentId: 'agent-2',
        targetAgentId: 'helper',
        sessionId: 'sess-2',
        prompt: 'do',
      });

      await manager.wipeAll();

      const tree = path.join(TEST_DIR, 'tmp', 'delegations');
      await expect(fs.access(tree)).rejects.toThrow();
      expect(await manager.list({ chatId: 'chat-1' })).toEqual([]);
      expect(await manager.list({ chatId: 'chat-2' })).toEqual([]);
    });
  });
});
