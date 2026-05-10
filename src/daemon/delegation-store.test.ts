import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DelegationStore, getDelegationsDir } from './delegation-store.js';
import type { PolicyDelegation } from '../shared/delegations.js';

vi.mock('../shared/workspace.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../shared/workspace.js')>();
  return {
    ...actual,
    getClawminiDir: () => path.join(process.cwd(), '.clawmini_test_delegations'),
  };
});

describe('DelegationStore', () => {
  const testDir = path.join(process.cwd(), '.clawmini_test_delegations');
  const store = new DelegationStore();
  const chatId = 'test-chat-123';

  beforeEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  it('can save and load a delegation', async () => {
    const id = await store.createUniqueId(chatId);
    const delegation: PolicyDelegation = {
      id,
      kind: 'policy',
      state: 'pending',
      delivery: 'notify',
      chatId,
      agentId: 'agent1',
      createdAt: new Date().toISOString(),
      commandName: 'ls',
      args: ['-l'],
      fileMappings: {},
    };

    await store.save(delegation);

    const loaded = await store.load(chatId, id);
    expect(loaded).toEqual(delegation);
  });

  it('returns null when loading non-existent delegation', async () => {
    const loaded = await store.load(chatId, 'nonexistent');
    expect(loaded).toBeNull();
  });

  it('can list delegations for a chat', async () => {
    const d1: PolicyDelegation = {
      id: await store.createUniqueId(chatId),
      kind: 'policy',
      state: 'pending',
      delivery: 'notify',
      chatId,
      agentId: 'agent1',
      createdAt: new Date().toISOString(),
      commandName: 'ls',
      args: ['-l'],
      fileMappings: {},
    };
    await store.save(d1);

    const d2: PolicyDelegation = {
      id: await store.createUniqueId(chatId), // wait, this might be same if mock is too fast? generateId uses crypto so it's fine
      kind: 'policy',
      state: 'running',
      delivery: 'manual',
      chatId,
      agentId: 'agent2',
      createdAt: new Date().toISOString(),
      commandName: 'pwd',
      args: [],
      fileMappings: {},
    };
    await store.save(d2);

    // Add a subscription dir to ensure it is ignored
    await fs.mkdir(path.join(getDelegationsDir(chatId), 'subscriptions'), { recursive: true });

    const list = await store.list(chatId);
    expect(list.length).toBe(2);
    expect(list).toEqual(expect.arrayContaining([d1, d2]));
  });

  it('returns empty array when listing empty or non-existent chat dir', async () => {
    const list = await store.list('empty-chat');
    expect(list).toEqual([]);
  });

  it('can delete a delegation', async () => {
    const id = await store.createUniqueId(chatId);
    const delegation: PolicyDelegation = {
      id,
      kind: 'policy',
      state: 'pending',
      delivery: 'notify',
      chatId,
      agentId: 'agent1',
      createdAt: new Date().toISOString(),
      commandName: 'ls',
      args: ['-l'],
      fileMappings: {},
    };

    await store.save(delegation);
    expect(await store.load(chatId, id)).not.toBeNull();

    await store.delete(chatId, id);
    expect(await store.load(chatId, id)).toBeNull();
  });

  it('does not throw when deleting non-existent delegation', async () => {
    await expect(store.delete(chatId, 'nonexistent')).resolves.not.toThrow();
  });
});
