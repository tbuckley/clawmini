import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readDiscordConfig } from './config.js';
import { getTRPCClient } from './client.js';

// Mock the modules
const { mockClientInstance } = vi.hoisted(() => ({
  mockClientInstance: {
    once: vi.fn(),
    on: vi.fn(),
    login: vi.fn().mockResolvedValue('token'),
    user: { id: 'bot-id', tag: 'bot#1234' },
  },
}));

vi.mock('discord.js', () => {
  return {
    Client: class {
      constructor() {
        return mockClientInstance;
      }
    },
    Events: {
      ClientReady: 'ready',
      MessageCreate: 'messageCreate',
    },
    GatewayIntentBits: {
      Guilds: 1,
      DirectMessages: 2,
      MessageContent: 3,
    },
    Partials: {
      Channel: 1,
    },
  };
});

vi.mock('./config.js', () => ({
  readDiscordConfig: vi.fn(),
  isAuthorized: vi.fn(),
}));

vi.mock('./client.js', () => ({
  getTRPCClient: vi.fn(),
}));

describe('Discord Adapter Entry Point', () => {
  let mockTrpc: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockTrpc = {
      sendMessage: {
        mutate: vi.fn().mockResolvedValue({ success: true }),
      },
    };
    vi.mocked(getTRPCClient).mockReturnValue(mockTrpc);
    vi.mocked(readDiscordConfig).mockResolvedValue({
      botToken: 'test-token',
      authorizedUserId: 'user-123',
    });

    // Reset the mock implementation to return the instance
    vi.mocked(mockClientInstance.on).mockReturnValue(mockClientInstance);
    vi.mocked(mockClientInstance.once).mockReturnValue(mockClientInstance);
  });

  it('should initialize Discord client and forward authorized DM messages', async () => {
    vi.useFakeTimers();
    let messageHandler: ((message: any) => Promise<void>) | undefined;
    vi.mocked(mockClientInstance.on).mockImplementation((event: string, cb: any) => {
      if (event === 'messageCreate') {
        messageHandler = cb;
      }
      return mockClientInstance as any;
    });

    const { main } = await import('./index.js');
    await main();

    expect(vi.mocked(mockClientInstance.login)).toHaveBeenCalledWith('test-token');
    expect(messageHandler).toBeDefined();

    const mockMessage = {
      author: { id: 'user-123', tag: 'user#1234' },
      content: 'Hello daemon!',
      guild: null,
    };

    const { isAuthorized } = await import('./config.js');
    vi.mocked(isAuthorized).mockReturnValue(true);

    if (messageHandler) {
      await messageHandler(mockMessage);
    }

    // Fast-forward time for debouncer
    await vi.runAllTimersAsync();

    expect(mockTrpc.sendMessage.mutate).toHaveBeenCalledWith({
      type: 'send-message',
      client: 'cli',
      data: {
        message: 'Hello daemon!',
      },
    });
    vi.useRealTimers();
  });

  it('should debounce multiple rapid messages into one', async () => {
    vi.useFakeTimers();
    let messageHandler: ((message: any) => Promise<void>) | undefined;
    vi.mocked(mockClientInstance.on).mockImplementation((event: string, cb: any) => {
      if (event === 'messageCreate') {
        messageHandler = cb;
      }
      return mockClientInstance as any;
    });

    const { main } = await import('./index.js');
    await main();

    const { isAuthorized } = await import('./config.js');
    vi.mocked(isAuthorized).mockReturnValue(true);

    if (messageHandler) {
      await messageHandler({
        author: { id: 'user-123', tag: 'user#1234' },
        content: 'message 1',
        guild: null,
      });
      await messageHandler({
        author: { id: 'user-123', tag: 'user#1234' },
        content: 'message 2',
        guild: null,
      });
    }

    // Should not have been called yet
    expect(mockTrpc.sendMessage.mutate).not.toHaveBeenCalled();

    // Fast-forward time for debouncer
    await vi.runAllTimersAsync();

    expect(mockTrpc.sendMessage.mutate).toHaveBeenCalledWith({
      type: 'send-message',
      client: 'cli',
      data: {
        message: 'message 1\nmessage 2',
      },
    });
    vi.useRealTimers();
  });

  it('should ignore unauthorized messages', async () => {
    let messageHandler: ((message: any) => Promise<void>) | undefined;
    vi.mocked(mockClientInstance.on).mockImplementation((event: string, cb: any) => {
      if (event === 'messageCreate') {
        messageHandler = cb;
      }
      return mockClientInstance as any;
    });

    const { main } = await import('./index.js');
    await main();

    const mockMessage = {
      author: { id: 'user-evil', tag: 'evil#666' },
      content: 'Hack the daemon!',
      guild: null,
    };

    const { isAuthorized } = await import('./config.js');
    vi.mocked(isAuthorized).mockReturnValue(false);

    if (messageHandler) {
      await messageHandler(mockMessage);
    }

    expect(mockTrpc.sendMessage.mutate).not.toHaveBeenCalled();
  });
});
