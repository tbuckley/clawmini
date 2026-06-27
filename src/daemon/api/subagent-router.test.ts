import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { agentRouter } from './agent-router.js';
import { daemonEvents, DAEMON_EVENT_DELEGATION_RESOLVED } from '../events.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockStoreData: Record<string, any> = {};

vi.mock('../delegation-store.js', () => ({
  DelegationStore: class {
    async load(chatId: string, id: string) {
      return mockStoreData[`${chatId}:${id}`] || null;
    }
    async list(chatId: string) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return Object.values(mockStoreData).filter((d: any) => d.chatId === chatId);
    }
  },
}));

vi.mock('../agent/chat-logger.js', () => ({
  createChatLogger: vi.fn(() => ({
    findLastMessage: vi.fn().mockResolvedValue({ role: 'log', content: 'Mock output' }),
  })),
}));

describe('subagentWait', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mockStoreData).forEach((key) => delete mockStoreData[key]);
  });

  afterEach(() => {
    daemonEvents.removeAllListeners();
  });

  it('should return synchronously if delegations are already resolved', async () => {
    const subagentId = 'sub-1';
    mockStoreData[`chat-1:${subagentId}`] = {
      id: subagentId,
      chatId: 'chat-1',
      state: 'completed',
      kind: 'subagent',
    };

    const ctx = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tokenPayload: {
        chatId: 'chat-1',
        agentId: 'agent',
        sessionId: 'session',
        timestamp: Date.now(),
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const caller = agentRouter.createCaller(ctx as any);

    const result = await caller.subagentWait({ subagentId });

    expect(result).toEqual({ status: 'completed', output: 'Mock output' });
  });

  it('should wait synchronously and resolve when event is emitted', async () => {
    const subagentId = 'sub-2';
    mockStoreData[`chat-1:${subagentId}`] = {
      id: subagentId,
      chatId: 'chat-1',
      state: 'pending',
      kind: 'subagent',
    };

    const ctx = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tokenPayload: {
        chatId: 'chat-1',
        agentId: 'agent',
        sessionId: 'session',
        timestamp: Date.now(),
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const caller = agentRouter.createCaller(ctx as any);

    const waitPromise = caller.subagentWait({ subagentId });

    setTimeout(() => {
      mockStoreData[`chat-1:${subagentId}`].state = 'completed';
      daemonEvents.emit(DAEMON_EVENT_DELEGATION_RESOLVED, {
        chatId: 'chat-1',
        delegationId: subagentId,
        state: 'completed',
      });
    }, 10);

    const result = await waitPromise;
    expect(result).toEqual({ status: 'completed', output: 'Mock output' });
  });
});
