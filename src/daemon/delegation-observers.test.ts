import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { ObserverRegistry } from './delegation-observers.js';
import { DelegationStore } from './delegation-store.js';
import * as notify from './delegation-notify.js';
import * as workspace from '../shared/workspace.js';
import type { Delegation } from '../shared/delegations.js';

vi.mock('../shared/workspace.js', () => ({
  getClawminiDir: vi.fn(),
  getWorkspaceRoot: vi.fn(),
}));

// Keep `formatAggregateBody` real (we assert on its output) but capture the
// `appendNotification` side effect instead of writing a chat message.
vi.mock('./delegation-notify.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./delegation-notify.js')>();
  return { ...actual, appendNotification: vi.fn() };
});

const TEST_DIR = path.join(process.cwd(), '.test-delegation-observers');

function subagent(id: string, state: Delegation['state']): Delegation {
  return {
    id,
    kind: 'subagent',
    state,
    delivery: 'notify',
    chatId: 'chat-1',
    agentId: 'agent-1',
    ...(state === 'completed' ? { resolvedAt: '2026-01-01T00:00:01.000Z' } : {}),
    createdAt: '2026-01-01T00:00:00.000Z',
    targetAgentId: 'helper',
    sessionId: 'sess-1',
    prompt: 'do',
  };
}

describe('ObserverRegistry', () => {
  let store: DelegationStore;
  let registry: ObserverRegistry;

  beforeEach(async () => {
    vi.mocked(workspace.getClawminiDir).mockReturnValue(TEST_DIR);
    vi.mocked(workspace.getWorkspaceRoot).mockReturnValue(process.cwd());
    vi.mocked(notify.appendNotification).mockClear();
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(TEST_DIR, { recursive: true });
    store = new DelegationStore();
    registry = new ObserverRegistry(store);
  });

  afterEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('does not fire an all-mode subscription until every member resolves', async () => {
    await store.save(subagent('aaa', 'running'));
    await store.save(subagent('bbb', 'running'));
    await registry.registerSubscription('chat-1', 'sess-root', ['aaa', 'bbb'], 'all');

    const { wasCovered } = await registry.onResolved('chat-1', subagent('aaa', 'completed'));
    expect(wasCovered).toBe(true);
    expect(notify.appendNotification).not.toHaveBeenCalled();
  });

  it('emits a partial aggregate on unsubscribe so suppressed completions are not lost', async () => {
    await store.save(subagent('aaa', 'running'));
    await store.save(subagent('bbb', 'running'));
    const subId = await registry.registerSubscription('chat-1', 'sess-root', ['aaa', 'bbb'], 'all');

    // 'aaa' resolves while covered — its per-id notification was suppressed.
    await registry.onResolved('chat-1', subagent('aaa', 'completed'));

    await registry.unsubscribe(subId);

    expect(notify.appendNotification).toHaveBeenCalledTimes(1);
    const body = vi.mocked(notify.appendNotification).mock.calls[0]![2];
    expect(body).toContain('completed (1): aaa');
    expect(body).toContain('still pending (1): bbb');
    // The subscription file is gone.
    expect(await store.loadSubscription('chat-1', subId)).toBeNull();
  });

  it('does not emit on unsubscribe when no member has resolved yet', async () => {
    await store.save(subagent('aaa', 'running'));
    const subId = await registry.registerSubscription('chat-1', 'sess-root', ['aaa'], 'any');

    await registry.unsubscribe(subId);

    expect(notify.appendNotification).not.toHaveBeenCalled();
  });

  it('lists still-pending ids when an any-mode subscription fires early', async () => {
    await store.save(subagent('aaa', 'running'));
    await store.save(subagent('bbb', 'running'));
    await registry.registerSubscription('chat-1', 'sess-root', ['aaa', 'bbb'], 'any');

    await registry.onResolved('chat-1', subagent('aaa', 'completed'));

    expect(notify.appendNotification).toHaveBeenCalledTimes(1);
    const body = vi.mocked(notify.appendNotification).mock.calls[0]![2];
    expect(body).toContain("1 of 2 delegations resolved (mode: 'any').");
    expect(body).toContain('still pending (1): bbb');
  });
});
