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

// Ticket 3 rewires `subagentWait` to `DelegationManager.wait` instead of the
// legacy `DAEMON_EVENT_MESSAGE_APPENDED` scrape. The tests below confirm:
//   * Wait fires for a delegation that resolves out-of-band.
//   * The fast-path early-return when the record is already terminal does
//     not leak any event listeners.

const TEST_DIR = path.join(process.cwd(), '.test-subagent-router');

describe('subagentWait (delegation-backed)', () => {
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

    const resultPromise = caller.subagentWait({ subagentId });

    // Resolve out-of-band — the wait should pick it up via the
    // DAEMON_EVENT_DELEGATION_RESOLVED listener.
    setTimeout(() => {
      void delegationManager.markResolved(subagentId, { state: 'completed' });
    }, 20);

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Timeout - event missed')), 1000)
    );

    const result = await Promise.race([resultPromise, timeoutPromise]);
    expect(result).toEqual({ status: 'completed', output: 'Mock output' });
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

    const result = await caller.subagentWait({ subagentId });
    expect(result).toEqual({ status: 'completed', output: 'Mock output' });

    expect(daemonEvents.listenerCount(DAEMON_EVENT_DELEGATION_RESOLVED)).toBe(initialListeners);
    expect(daemonEvents.listenerCount(DAEMON_EVENT_MESSAGE_APPENDED)).toBe(messageListeners);
  });
});
