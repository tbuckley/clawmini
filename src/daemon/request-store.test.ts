import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RequestStore } from './request-store.js';
import type { PolicyRequest } from '../shared/policies.js';
import fs from 'fs/promises';
import path from 'path';
import * as workspace from '../shared/workspace.js';

vi.mock('../shared/workspace.js', () => ({
  resolveAgentWorkDir: vi
    .fn()
    .mockImplementation((id, dir, root) => (dir ? `${root}/${dir}` : `${root}/${id}`)),

  getClawminiDir: vi.fn(),
}));

describe('RequestStore', () => {
  const TEST_DIR = path.join(process.cwd(), '.test-requests');
  let store: RequestStore;

  beforeEach(async () => {
    vi.mocked(workspace.getClawminiDir).mockReturnValue(TEST_DIR);
    store = new RequestStore();
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('should save and load a request', async () => {
    const req: PolicyRequest = {
      id: 'req-123',
      commandName: 'test-cmd',
      args: ['arg1'],
      fileMappings: {},
      state: 'Pending',
      createdAt: Date.now(),
      chatId: 'chat-1',
      agentId: 'agent-1',
    };

    await store.save(req);
    const loaded = await store.load('req-123');
    expect(loaded).toEqual(req);
  });

  it('should return null for non-existent request', async () => {
    const loaded = await store.load('missing-req');
    expect(loaded).toBeNull();
  });

  it('should list requests sorted by createdAt descending', async () => {
    const req1: PolicyRequest = {
      id: 'req-1',
      commandName: 'cmd1',
      args: [],
      fileMappings: {},
      state: 'Pending',
      createdAt: 1000,
      chatId: 'chat-1',
      agentId: 'agent-1',
    };
    const req2: PolicyRequest = {
      id: 'req-2',
      commandName: 'cmd2',
      args: [],
      fileMappings: {},
      state: 'Pending',
      createdAt: 2000,
      chatId: 'chat-2',
      agentId: 'agent-2',
    };

    await store.save(req1);
    await store.save(req2);

    const list = await store.list();
    expect(list).toHaveLength(2);
    expect(list[0]?.id).toBe('REQ-2');
    expect(list[1]?.id).toBe('REQ-1');
  });

  it('should gracefully handle corrupted files during load', async () => {
    const req: PolicyRequest = {
      id: 'req-good',
      commandName: 'cmd',
      args: [],
      fileMappings: {},
      state: 'Pending',
      createdAt: 1000,
      chatId: 'chat-1',
      agentId: 'agent-1',
    };
    await store.save(req);

    await fs.writeFile(path.join(TEST_DIR, 'tmp', 'requests', 'REQ-CORRUPT.json'), 'invalid json');

    const loadedCorrupt = await store.load('req-corrupt');
    expect(loadedCorrupt).toBeNull();

    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe('REQ-GOOD');
  });
});
