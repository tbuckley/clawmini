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
    it('sendToSubagent throws NOT_FOUND for an unknown id', async () => {
      // Ticket 4: sendToSubagent is now an approval-gated update. Calling it
      // on a missing record throws an Error with `code: 'NOT_FOUND'`
      // (matching the wire shape of `assertVisibleTo`).
      try {
        await manager.sendToSubagent('zzz', 'chat-1', 'hi', { autoApprove: true });
        throw new Error('expected sendToSubagent to throw');
      } catch (err: unknown) {
        const code = (err as { code?: string }).code;
        expect(code).toBe('NOT_FOUND');
      }
    });

    it('sendToSubagent flips state to running on autoApprove=true', async () => {
      // First create a subagent (autoApprove=true so it lands in 'running')
      // and resolve it so the next send is exercising the wake path.
      const created = await manager.createSubagent({
        chatId: 'chat-send',
        agentId: 'agent-1',
        targetAgentId: 'agent-1',
        sessionId: 'sess-1',
        prompt: 'first',
        autoApprove: true,
      });
      await manager.markResolved(created.id, { state: 'completed' });
      const updated = await manager.sendToSubagent(created.id, 'chat-send', 'second', {
        autoApprove: true,
      });
      expect(updated.kind).toBe('subagent');
      expect(updated.state).toBe('running');
      expect(updated.prompt).toBe('second');
    });

    it('sendToSubagent moves to pending on autoApprove=false', async () => {
      const created = await manager.createSubagent({
        chatId: 'chat-send-pending',
        agentId: 'agent-1',
        targetAgentId: 'agent-1',
        sessionId: 'sess-2',
        prompt: 'first',
        autoApprove: true,
      });
      await manager.markResolved(created.id, { state: 'completed' });
      const updated = await manager.sendToSubagent(created.id, 'chat-send-pending', 'second', {
        autoApprove: false,
      });
      expect(updated.state).toBe('pending');
      expect(updated.prompt).toBe('second');
    });

    it('unsubscribe is a no-op for unknown ids', async () => {
      // Unknown subscription id: the in-memory record is gone so we can't
      // find the chat — the call is a no-op (the file, if any, will be
      // cleared on next daemon boot via wipeAll).
      await expect(manager.unsubscribe('sub-unknown')).resolves.toBeUndefined();
    });
  });

  describe('assertVisibleTo', () => {
    it('returns the subagent when parentId matches the caller', async () => {
      const created = await manager.createSubagent({
        chatId: 'chat-1',
        agentId: 'agent-1',
        targetAgentId: 'helper',
        sessionId: 'sess-1',
        prompt: 'do',
        parentId: 'parent-sub',
      });
      const got = await manager.assertVisibleTo('parent-sub', created.id, 'chat-1');
      expect(got.id).toBe(created.id);
    });

    it('returns the subagent when both caller and parent are undefined (root agent)', async () => {
      const created = await manager.createSubagent({
        chatId: 'chat-1',
        agentId: 'agent-1',
        targetAgentId: 'helper',
        sessionId: 'sess-1',
        prompt: 'do',
      });
      const got = await manager.assertVisibleTo(undefined, created.id, 'chat-1');
      expect(got.id).toBe(created.id);
    });

    it('throws NOT_FOUND when the id does not exist', async () => {
      await expect(manager.assertVisibleTo(undefined, 'zzz', 'chat-1')).rejects.toThrow(
        /Subagent not found/
      );
    });

    it('throws FORBIDDEN when parentId mismatches the caller', async () => {
      const created = await manager.createSubagent({
        chatId: 'chat-1',
        agentId: 'agent-1',
        targetAgentId: 'helper',
        sessionId: 'sess-1',
        prompt: 'do',
        parentId: 'parent-a',
      });
      await expect(
        manager.assertVisibleTo('different-parent', created.id, 'chat-1')
      ).rejects.toThrow(/not a child of the caller/);
    });

    it('throws NOT_FOUND when the id refers to a policy delegation', async () => {
      const created = await manager.createPolicy({
        chatId: 'chat-1',
        agentId: 'agent-1',
        commandName: 'echo',
        args: [],
        fileMappings: {},
      });
      await expect(manager.assertVisibleTo(undefined, created.id, 'chat-1')).rejects.toThrow(
        /Subagent not found/
      );
    });
  });

  describe('update', () => {
    it('refreshes the prompt and state in place', async () => {
      const created = await manager.createSubagent({
        chatId: 'chat-1',
        agentId: 'agent-1',
        targetAgentId: 'helper',
        sessionId: 'sess-1',
        prompt: 'first',
        autoApprove: true,
      });
      const updated = await manager.update(created.id, 'chat-1', {
        prompt: 'second',
      });
      expect(updated.kind).toBe('subagent');
      if (updated.kind !== 'subagent') throw new Error('expected subagent');
      expect(updated.prompt).toBe('second');
      const loaded = await store.load('chat-1', created.id);
      expect(loaded?.kind).toBe('subagent');
      if (loaded?.kind !== 'subagent') throw new Error('expected subagent');
      expect(loaded.prompt).toBe('second');
    });
  });

  describe('wait (single-id sync)', () => {
    it('returns immediately when the delegation is already resolved', async () => {
      const created = await manager.createSubagent({
        chatId: 'chat-1',
        agentId: 'agent-1',
        targetAgentId: 'helper',
        sessionId: 'sess-1',
        prompt: 'do',
        autoApprove: true,
      });
      await manager.markResolved(created.id, { state: 'completed' });

      const result = await manager.wait({
        ids: [created.id],
        mode: 'any',
        return: 'sync',
        chatId: 'chat-1',
      });
      expect(result.resolved).toHaveLength(1);
      expect(result.resolved[0]?.state).toBe('completed');
      expect(result.pending).toHaveLength(0);
    });

    it('blocks until DAEMON_EVENT_DELEGATION_RESOLVED fires for the matching id', async () => {
      const created = await manager.createSubagent({
        chatId: 'chat-1',
        agentId: 'agent-1',
        targetAgentId: 'helper',
        sessionId: 'sess-1',
        prompt: 'do',
        autoApprove: true,
      });

      const waitPromise = manager.wait({
        ids: [created.id],
        mode: 'any',
        return: 'sync',
        chatId: 'chat-1',
        timeoutMs: 5000,
      });

      // Resolve out-of-band — the wait should pick it up via the event.
      setTimeout(() => {
        void manager.markResolved(created.id, { state: 'completed' });
      }, 10);

      const result = await waitPromise;
      expect(result.resolved).toHaveLength(1);
      expect(result.resolved[0]?.id).toBe(created.id);
      expect(result.resolved[0]?.state).toBe('completed');
    });

    it('times out and returns the still-pending delegation', async () => {
      const created = await manager.createSubagent({
        chatId: 'chat-1',
        agentId: 'agent-1',
        targetAgentId: 'helper',
        sessionId: 'sess-1',
        prompt: 'do',
        autoApprove: true,
      });

      const result = await manager.wait({
        ids: [created.id],
        mode: 'any',
        return: 'sync',
        chatId: 'chat-1',
        timeoutMs: 30,
      });
      expect(result.resolved).toHaveLength(0);
      expect(result.pending).toHaveLength(1);
      expect(result.pending[0]?.id).toBe(created.id);
      expect(result.pending[0]?.state).toBe('running');
    });

    it('returns no records when the id is unknown', async () => {
      const result = await manager.wait({
        ids: ['ghost'],
        mode: 'any',
        return: 'sync',
        chatId: 'chat-1',
        timeoutMs: 30,
      });
      expect(result.resolved).toEqual([]);
      expect(result.pending).toEqual([]);
    });

    it('ignores events for other chats / ids', async () => {
      const created = await manager.createSubagent({
        chatId: 'chat-1',
        agentId: 'agent-1',
        targetAgentId: 'helper',
        sessionId: 'sess-1',
        prompt: 'do',
        autoApprove: true,
      });
      const other = await manager.createSubagent({
        chatId: 'chat-1',
        agentId: 'agent-1',
        targetAgentId: 'helper',
        sessionId: 'sess-1',
        prompt: 'do',
        autoApprove: true,
      });

      const waitPromise = manager.wait({
        ids: [created.id],
        mode: 'any',
        return: 'sync',
        chatId: 'chat-1',
        timeoutMs: 200,
      });

      // Resolve the *other* id — wait should not fire for it.
      setTimeout(() => {
        void manager.markResolved(other.id, { state: 'completed' });
      }, 10);

      const result = await waitPromise;
      expect(result.resolved).toEqual([]);
      expect(result.pending).toHaveLength(1);
      expect(result.pending[0]?.id).toBe(created.id);
    });
  });

  describe('wait (multi-id / mode=all / subscribe)', () => {
    it('blocks until ALL resolve when mode=all', async () => {
      const a = await manager.createSubagent({
        chatId: 'chat-1',
        agentId: 'agent-1',
        targetAgentId: 'helper',
        sessionId: 's',
        prompt: 'a',
        autoApprove: true,
      });
      const b = await manager.createSubagent({
        chatId: 'chat-1',
        agentId: 'agent-1',
        targetAgentId: 'helper',
        sessionId: 's',
        prompt: 'b',
        autoApprove: true,
      });

      const waitPromise = manager.wait({
        ids: [a.id, b.id],
        mode: 'all',
        return: 'sync',
        chatId: 'chat-1',
        timeoutMs: 5000,
      });

      setTimeout(() => {
        void manager.markResolved(a.id, { state: 'completed' });
      }, 10);
      setTimeout(() => {
        void manager.markResolved(b.id, { state: 'completed' });
      }, 30);

      const result = await waitPromise;
      expect(result.resolved).toHaveLength(2);
      expect(result.pending).toHaveLength(0);
    });

    it('subscribe returns a subscriptionId immediately and fires later', async () => {
      const a = await manager.createSubagent({
        chatId: 'chat-sub',
        agentId: 'agent-1',
        targetAgentId: 'helper',
        sessionId: 's',
        prompt: 'a',
        autoApprove: true,
        delivery: 'manual',
      });

      const { subscriptionId } = await manager.wait({
        ids: [a.id],
        mode: 'all',
        return: 'subscribe',
        chatId: 'chat-sub',
        originSessionId: 'origin-session-1',
      });
      expect(subscriptionId).toMatch(/^sub-/);

      // Subscription file is persisted under the chat's subscriptions/ dir.
      const subFile = path.join(
        TEST_DIR,
        'tmp',
        'delegations',
        'chat-sub',
        'subscriptions',
        `${subscriptionId}.json`
      );
      const raw = await fs.readFile(subFile, 'utf8');
      const parsed = JSON.parse(raw);
      expect(parsed.originSessionId).toBe('origin-session-1');
      expect(parsed.ids).toEqual([a.id]);

      // After resolving, the subscription file is deleted.
      await manager.markResolved(a.id, { state: 'completed' });
      await expect(fs.access(subFile)).rejects.toThrow();
    });

    it('markResolved reports wasCovered when an observer is watching', async () => {
      const a = await manager.createSubagent({
        chatId: 'chat-cover',
        agentId: 'agent-1',
        targetAgentId: 'helper',
        sessionId: 's',
        prompt: 'a',
        autoApprove: true,
      });

      const { subscriptionId } = await manager.wait({
        ids: [a.id],
        mode: 'any',
        return: 'subscribe',
        chatId: 'chat-cover',
        originSessionId: 'origin-session-cover',
      });
      expect(subscriptionId).toBeTruthy();

      const { wasCovered } = await manager.markResolved(a.id, { state: 'completed' });
      expect(wasCovered).toBe(true);
    });

    it('unsubscribe removes the subscription without firing', async () => {
      const a = await manager.createSubagent({
        chatId: 'chat-unsub',
        agentId: 'agent-1',
        targetAgentId: 'helper',
        sessionId: 's',
        prompt: 'a',
        autoApprove: true,
      });

      const { subscriptionId } = await manager.wait({
        ids: [a.id],
        mode: 'all',
        return: 'subscribe',
        chatId: 'chat-unsub',
        originSessionId: 'origin-session-unsub',
      });

      await manager.unsubscribe(subscriptionId);

      // The file is gone.
      const subFile = path.join(
        TEST_DIR,
        'tmp',
        'delegations',
        'chat-unsub',
        'subscriptions',
        `${subscriptionId}.json`
      );
      await expect(fs.access(subFile)).rejects.toThrow();

      // Subsequent resolve is no longer covered (suppression lifted).
      const { wasCovered } = await manager.markResolved(a.id, { state: 'completed' });
      expect(wasCovered).toBe(false);
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
