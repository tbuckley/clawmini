import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { agentRouter } from './agent-router.js';
import {
  daemonEvents,
  DAEMON_EVENT_DELEGATION_RESOLVED,
  DAEMON_EVENT_MESSAGE_APPENDED,
} from '../events.js';
import * as workspace from '../../shared/workspace.js';
import { DelegationStore } from '../delegation-store.js';
import { delegationManager } from '../delegation-manager.js';

vi.mock('../../shared/workspace.js', () => ({
  readChatSettings: vi.fn(),
  updateChatSettings: vi.fn(),
  getWorkspaceRoot: vi.fn().mockReturnValue('/mock/root'),
  getClawminiDir: vi.fn(),
}));

vi.mock('../agent/chat-logger.js', () => ({
  createChatLogger: vi.fn(() => ({
    findLastMessage: vi.fn().mockResolvedValue({ role: 'agent', content: 'Mock output' }),
    getMessages: vi.fn().mockResolvedValue([]),
  })),
}));

// Ticket 8 removed the `subagentWait` tRPC wrapper. The kind-agnostic
// `delegationWait` is now the only wait endpoint; the CLI's `subagents
// spawn|send` (non-async) call it directly. These tests assert the new
// wait endpoint still resolves out-of-band and doesn't leak listeners.

const TEST_DIR = path.join(process.cwd(), '.test-subagent-router');

describe('delegationWait (subagent-backed)', () => {
  beforeEach(async () => {
    vi.mocked(workspace.getClawminiDir).mockReturnValue(TEST_DIR);
    vi.mocked(workspace.getWorkspaceRoot).mockReturnValue(TEST_DIR);
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(TEST_DIR, { recursive: true });
    // Inject a freshly-rooted store into the singleton manager.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (delegationManager as any)._store = new DelegationStore(TEST_DIR);
  });

  afterEach(async () => {
    daemonEvents.removeAllListeners();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (delegationManager as any)._store = null;
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('returns the completed result when the delegation resolves out-of-band', async () => {
    const chatId = 'chat-1';
    const subagentId = 'sub-1';

    await delegationManager.createSubagent({
      chatId,
      agentId: 'agent-1',
      targetAgentId: 'helper',
      sessionId: 'sess-1',
      prompt: 'do',
      autoApprove: true,
      id: subagentId,
    });

    const ctx = {
      tokenPayload: { chatId, agentId: 'agent-1', sessionId: 'sess-1' },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const caller = agentRouter.createCaller(ctx as any);

    const resultPromise = caller.delegationWait({
      ids: [subagentId],
      mode: 'any',
      return: 'sync',
      timeoutMs: 1_000,
    });

    // Resolve out-of-band — the wait should pick it up via the
    // DAEMON_EVENT_DELEGATION_RESOLVED listener.
    setTimeout(() => {
      void delegationManager.markResolved(subagentId, { state: 'completed' });
    }, 20);

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Timeout - event missed')), 1500)
    );

    const result = (await Promise.race([resultPromise, timeoutPromise])) as {
      kind: 'sync';
      resolved: Array<{ id: string; state: string }>;
      pending: Array<{ id: string }>;
    };
    expect(result.kind).toBe('sync');
    expect(result.resolved[0]?.id).toBe(subagentId);
    expect(result.resolved[0]?.state).toBe('completed');
  });

  it('does not leave any DELEGATION_RESOLVED listeners after an early return', async () => {
    const chatId = 'chat-2';
    const subagentId = 'sub-2';

    // Already-terminal delegation — wait hits the fast path.
    await delegationManager.createSubagent({
      chatId,
      agentId: 'agent-1',
      targetAgentId: 'helper',
      sessionId: 'sess-1',
      prompt: 'do',
      autoApprove: true,
      id: subagentId,
    });
    await delegationManager.markResolved(subagentId, { state: 'completed' });

    const ctx = {
      tokenPayload: { chatId, agentId: 'agent-1', sessionId: 'sess-1' },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const caller = agentRouter.createCaller(ctx as any);

    const initialListeners = daemonEvents.listenerCount(DAEMON_EVENT_DELEGATION_RESOLVED);
    const messageListeners = daemonEvents.listenerCount(DAEMON_EVENT_MESSAGE_APPENDED);

    const result = await caller.delegationWait({
      ids: [subagentId],
      mode: 'any',
      return: 'sync',
      timeoutMs: 1_000,
    });
    expect(result.kind).toBe('sync');
    if (result.kind === 'sync') {
      expect(result.resolved[0]?.id).toBe(subagentId);
    }

    expect(daemonEvents.listenerCount(DAEMON_EVENT_DELEGATION_RESOLVED)).toBe(initialListeners);
    expect(daemonEvents.listenerCount(DAEMON_EVENT_MESSAGE_APPENDED)).toBe(messageListeners);
  });
});
