import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { DelegationStore } from './delegation-store.js';
import type {
  Delegation,
  PolicyDelegation,
  SubagentDelegation,
  DelegationSubscription,
} from '../shared/delegations.js';
import * as workspace from '../shared/workspace.js';

vi.mock('../shared/workspace.js', () => ({
  getClawminiDir: vi.fn(),
}));

const TEST_DIR = path.join(process.cwd(), '.test-delegations');

function makePolicy(overrides: Partial<PolicyDelegation> = {}): PolicyDelegation {
  return {
    id: 'p01',
    kind: 'policy',
    state: 'pending',
    delivery: 'notify',
    chatId: 'chat-1',
    agentId: 'agent-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    commandName: 'run-host',
    args: ['echo', 'hi'],
    fileMappings: {},
    ...overrides,
  };
}

function makeSubagent(overrides: Partial<SubagentDelegation> = {}): SubagentDelegation {
  return {
    id: 's01',
    kind: 'subagent',
    state: 'running',
    delivery: 'manual',
    chatId: 'chat-1',
    agentId: 'agent-1',
    createdAt: '2026-01-02T00:00:00.000Z',
    targetAgentId: 'helper-agent',
    sessionId: 'sess-1',
    prompt: 'do the thing',
    ...overrides,
  };
}

describe('DelegationStore', () => {
  let store: DelegationStore;

  beforeEach(async () => {
    vi.mocked(workspace.getClawminiDir).mockReturnValue(TEST_DIR);
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(TEST_DIR, { recursive: true });
    store = new DelegationStore();
  });

  afterEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('round-trips a PolicyDelegation', async () => {
    const policy = makePolicy({
      executionResult: { stdout: 'ok', stderr: '', exitCode: 0 },
      resolvedAt: '2026-01-01T00:01:00.000Z',
      state: 'completed',
      cwd: '/tmp',
    });
    await store.save(policy);
    const loaded = await store.load(policy.chatId, policy.id);
    expect(loaded).toEqual(policy);
  });

  it('round-trips a SubagentDelegation', async () => {
    const sub = makeSubagent({ parentId: 'parent-id' });
    await store.save(sub);
    const loaded = await store.load(sub.chatId, sub.id);
    expect(loaded).toEqual(sub);
  });

  it('returns null when loading a missing record', async () => {
    expect(await store.load('chat-1', 'nope')).toBeNull();
  });

  it('writes records under per-chat directories', async () => {
    const a = makePolicy({ id: 'a01', chatId: 'chat-A' });
    const b = makeSubagent({ id: 'b01', chatId: 'chat-B' });
    await store.save(a);
    await store.save(b);
    const aPath = path.join(TEST_DIR, 'tmp', 'delegations', 'chat-A', 'a01.json');
    const bPath = path.join(TEST_DIR, 'tmp', 'delegations', 'chat-B', 'b01.json');
    await expect(fs.access(aPath)).resolves.toBeUndefined();
    await expect(fs.access(bPath)).resolves.toBeUndefined();
  });

  it('list() returns only records for the given chatId', async () => {
    await store.save(makePolicy({ id: 'p01', chatId: 'chat-1' }));
    await store.save(makeSubagent({ id: 's01', chatId: 'chat-1' }));
    await store.save(makePolicy({ id: 'x01', chatId: 'chat-2' }));

    const c1 = await store.list('chat-1');
    expect(c1.map((d) => d.id).sort()).toEqual(['p01', 's01']);

    const c2 = await store.list('chat-2');
    expect(c2.map((d) => d.id)).toEqual(['x01']);
  });

  it('list() filters by state (single + array) and by kind', async () => {
    await store.save(makePolicy({ id: 'p01', state: 'pending' }));
    await store.save(makePolicy({ id: 'p02', state: 'completed' }));
    await store.save(makeSubagent({ id: 's01', state: 'running' }));
    await store.save(makeSubagent({ id: 's02', state: 'failed' }));

    const pending = await store.list('chat-1', { state: 'pending' });
    expect(pending.map((d) => d.id)).toEqual(['p01']);

    const active = await store.list('chat-1', { state: ['pending', 'running'] });
    expect(active.map((d) => d.id).sort()).toEqual(['p01', 's01']);

    const subs = await store.list('chat-1', { kind: 'subagent' });
    expect(subs.map((d) => d.id).sort()).toEqual(['s01', 's02']);

    const completedPolicies = await store.list('chat-1', {
      kind: 'policy',
      state: 'completed',
    });
    expect(completedPolicies.map((d) => d.id)).toEqual(['p02']);
  });

  it('list() filters by parentId', async () => {
    await store.save(makeSubagent({ id: 's01', parentId: 'p-A' }));
    await store.save(makeSubagent({ id: 's02', parentId: 'p-B' }));
    await store.save(makeSubagent({ id: 's03' }));

    const childrenA = await store.list('chat-1', { parentId: 'p-A' });
    expect(childrenA.map((d) => d.id)).toEqual(['s01']);
  });

  it('list() returns empty array when the chat dir does not exist', async () => {
    expect(await store.list('never-existed')).toEqual([]);
  });

  it('delete() removes a record and is idempotent', async () => {
    const policy = makePolicy();
    await store.save(policy);
    await store.delete(policy.chatId, policy.id);
    expect(await store.load(policy.chatId, policy.id)).toBeNull();
    // second delete is a no-op
    await expect(store.delete(policy.chatId, policy.id)).resolves.toBeUndefined();
  });

  it('load() throws on a corrupted JSON file', async () => {
    await fs.mkdir(path.join(TEST_DIR, 'tmp', 'delegations', 'chat-1'), { recursive: true });
    await fs.writeFile(
      path.join(TEST_DIR, 'tmp', 'delegations', 'chat-1', 'bad.json'),
      'not json',
      'utf8'
    );
    await expect(store.load('chat-1', 'bad')).rejects.toThrow(/Corrupt delegation file/);
  });

  it('load() throws when a file fails schema validation', async () => {
    await fs.mkdir(path.join(TEST_DIR, 'tmp', 'delegations', 'chat-1'), { recursive: true });
    await fs.writeFile(
      path.join(TEST_DIR, 'tmp', 'delegations', 'chat-1', 'wrong.json'),
      JSON.stringify({ id: 'wrong', kind: 'unknown' }),
      'utf8'
    );
    await expect(store.load('chat-1', 'wrong')).rejects.toThrow(/Corrupt delegation file/);
  });

  it('generateId() returns a 3-char [0-9a-z] id in an empty chat', async () => {
    const id = await store.generateId('chat-1');
    expect(id).toMatch(/^[0-9a-z]{3}$/);
  });

  it('generateId() grows past 3 chars under synthetic collision', async () => {
    // Inject a deterministic random function so we know which ids will be
    // rolled: first two rolls at length 3 return 'aaa' (collision), then at
    // length 4 we get 'bbbb' (free).
    const chatId = 'crowded';
    const dir = path.join(TEST_DIR, 'tmp', 'delegations', chatId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'aaa.json'), '{}', 'utf8');

    let call = 0;
    const randomFn = (length: number): string => {
      call++;
      if (length === 3) return 'aaa';
      // length 4 → free id
      return 'b'.repeat(length);
    };

    const id = await store.generateId(chatId, {
      randomFn,
      attemptsBeforeGrow: () => 1, // grow after a single collision at length 3
    });
    expect(id).toBe('bbbb');
    expect(id.length).toBe(4);
    expect(call).toBeGreaterThanOrEqual(2); // at least one collision + the successful roll
  });

  it('generateId() returns the first non-colliding 3-char id without growing', async () => {
    // Sanity-check the default branch: when length-3 succeeds, no growth.
    let i = 0;
    const ids = ['000', '111', '222'];
    const id = await store.generateId('chat-1', { randomFn: () => ids[i++ % ids.length]! });
    expect(id).toBe('000');
  });

  it('subscription IO round-trips', async () => {
    const sub: DelegationSubscription = {
      subscriptionId: 'sub-1',
      chatId: 'chat-1',
      originSessionId: 'sess-1',
      ids: ['p01', 's01'],
      mode: 'all',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    await store.saveSubscription(sub);
    expect(await store.loadSubscription('chat-1', 'sub-1')).toEqual(sub);

    const list = await store.listSubscriptions('chat-1');
    expect(list).toEqual([sub]);

    await store.deleteSubscription('chat-1', 'sub-1');
    expect(await store.loadSubscription('chat-1', 'sub-1')).toBeNull();
    expect(await store.listSubscriptions('chat-1')).toEqual([]);
  });

  it('wipeAll() removes every chat subdir and subscription dir', async () => {
    await store.save(makePolicy({ id: 'p01', chatId: 'chat-1' }));
    await store.save(makeSubagent({ id: 's01', chatId: 'chat-2' }));
    await store.saveSubscription({
      subscriptionId: 'sub-1',
      chatId: 'chat-1',
      originSessionId: 'sess-1',
      ids: ['p01'],
      mode: 'any',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    const tree = path.join(TEST_DIR, 'tmp', 'delegations');
    await expect(fs.access(tree)).resolves.toBeUndefined();

    await store.wipeAll();

    // Whole tree should be gone.
    await expect(fs.access(tree)).rejects.toThrow();
    // And subsequent reads/listings just return empty.
    expect(await store.list('chat-1')).toEqual([]);
    expect(await store.listSubscriptions('chat-1')).toEqual([]);
  });

  it('list() sorts by createdAt descending', async () => {
    const oldest: Delegation = makePolicy({
      id: 'a01',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const middle: Delegation = makeSubagent({
      id: 'b01',
      createdAt: '2026-01-02T00:00:00.000Z',
    });
    const newest: Delegation = makePolicy({
      id: 'c01',
      createdAt: '2026-01-03T00:00:00.000Z',
    });
    await store.save(oldest);
    await store.save(middle);
    await store.save(newest);

    const listed = await store.list('chat-1');
    expect(listed.map((d) => d.id)).toEqual(['c01', 'b01', 'a01']);
  });
});
