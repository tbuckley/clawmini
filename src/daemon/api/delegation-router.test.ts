import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { agentRouter } from './agent-router.js';
import { daemonEvents, emitDelegationResolved } from '../events.js';

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

describe('delegationWait', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mockStoreData).forEach((key) => delete mockStoreData[key]);
  });

  afterEach(() => {
    daemonEvents.removeAllListeners();
  });

  it('should return synchronously if delegations are already resolved', async () => {
    mockStoreData['chat1:del1'] = {
      id: 'del1',
      chatId: 'chat1',
      state: 'completed',
      kind: 'policy',
    };

    const caller = agentRouter.createCaller({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      req: {} as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      res: {} as any,
      isApiServer: true,
      tokenPayload: {
        chatId: 'chat1',
        agentId: 'agent1',
        sessionId: 'sess1',
        timestamp: Date.now(),
      },
    });

    const result = await caller.delegationWait({ ids: ['del1'], mode: 'any', return: 'sync' });

    expect(result.type).toBe('sync');
    if (result.type === 'sync' && result.resolved) {
      expect(result.resolved).toHaveLength(1);
      expect(result.resolved[0]?.id).toBe('del1');
    }
  });

  it('should subscribe and return ID when returning subscribe and unresolved', async () => {
    mockStoreData['chat1:del1'] = {
      id: 'del1',
      chatId: 'chat1',
      state: 'pending',
      kind: 'subagent',
    };

    const caller = agentRouter.createCaller({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      req: {} as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      res: {} as any,
      isApiServer: true,
      tokenPayload: {
        chatId: 'chat1',
        agentId: 'agent1',
        sessionId: 'sess1',
        timestamp: Date.now(),
      },
    });

    const result = await caller.delegationWait({ ids: ['del1'], mode: 'any', return: 'subscribe' });

    expect(result.type).toBe('subscribe');
    if (result.type === 'subscribe') {
      expect(result.subscriptionId).toBeDefined();
    }
  });

  it('should wait synchronously and resolve when event is emitted', async () => {
    mockStoreData['chat1:del1'] = {
      id: 'del1',
      chatId: 'chat1',
      state: 'pending',
      kind: 'subagent',
    };

    const caller = agentRouter.createCaller({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      req: {} as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      res: {} as any,
      isApiServer: true,
      tokenPayload: {
        chatId: 'chat1',
        agentId: 'agent1',
        sessionId: 'sess1',
        timestamp: Date.now(),
      },
    });

    const waitPromise = caller.delegationWait({ ids: ['del1'], mode: 'any', return: 'sync' });

    // Simulate resolution event
    setTimeout(() => {
      mockStoreData['chat1:del1'].state = 'completed';
      emitDelegationResolved({ chatId: 'chat1', delegationId: 'del1', state: 'completed' });
    }, 10);

    const result = await waitPromise;
    expect(result.type).toBe('sync');
  });
});
