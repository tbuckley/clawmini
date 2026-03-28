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
  initDiscordConfig: vi.fn(),
  isAuthorized: vi.fn(),
  getDiscordConfigPath: vi.fn(),
}));

vi.mock('./client.js', () => ({
  getTRPCClient: vi.fn(),
}));

describe('Discord Adapter Entry Point', () => {
  let mockTrpc: ReturnType<typeof import('./client.js').getTRPCClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockTrpc = {
      sendMessage: {
        mutate: vi.fn().mockResolvedValue({ success: true }),
      },
    } as unknown as ReturnType<typeof import('./client.js').getTRPCClient>;
    vi.mocked(getTRPCClient).mockReturnValue(mockTrpc);
    vi.mocked(readDiscordConfig).mockResolvedValue({
      botToken: 'test-token',
      authorizedUserId: 'user-123',
      chatId: 'default',
    });

    // Reset the mock implementation to return the instance
    vi.mocked(mockClientInstance.on).mockReturnValue(mockClientInstance);
    vi.mocked(mockClientInstance.once).mockReturnValue(mockClientInstance);
  });

  it('should initialize Discord config and exit if init argument is provided', async () => {
    process.argv = ['node', 'index.js', 'init'];
    const { initDiscordConfig } = await import('./config.js');
    const { main } = await import('./index.js');
    await main();

    expect(initDiscordConfig).toHaveBeenCalled();
    expect(vi.mocked(mockClientInstance.login)).not.toHaveBeenCalled();
    process.argv = []; // reset
  });

  it('should initialize Discord client and forward authorized DM messages', async () => {
    vi.useFakeTimers();
    let messageHandler: ((message: import('discord.js').Message) => Promise<void>) | undefined;
    vi.mocked(mockClientInstance.on).mockImplementation(
      (event: string, cb: (...args: unknown[]) => void) => {
        if (event === 'messageCreate') {
          messageHandler = cb as unknown as (
            message: import('discord.js').Message
          ) => Promise<void>;
        }
        return mockClientInstance as unknown as import('discord.js').Client;
      }
    );

    const { main } = await import('./index.js');
    await main();

    expect(vi.mocked(mockClientInstance.login)).toHaveBeenCalledWith('test-token');
    expect(messageHandler).toBeDefined();

    const mockMessage = {
      author: { id: 'user-123', tag: 'user#1234' },
      content: 'Hello daemon!',
      guild: null,
      attachments: new Map(),
    };

    const { isAuthorized } = await import('./config.js');
    vi.mocked(isAuthorized).mockReturnValue(true);

    if (messageHandler) {
      await messageHandler(mockMessage as unknown as import('discord.js').Message);
    }

    // Fast-forward time for debouncer
    await vi.runAllTimersAsync();

    expect(mockTrpc.sendMessage.mutate).toHaveBeenCalledWith({
      type: 'send-message',
      client: 'cli',
      data: {
        message: 'Hello daemon!',
        chatId: 'default',
        files: undefined,
        adapter: 'discord',
        noWait: true,
      },
    });
    vi.useRealTimers();
  });

  it('should ignore duplicate network events based on Discord message ID', async () => {
    let messageHandler: ((message: import('discord.js').Message) => Promise<void>) | undefined;
    vi.mocked(mockClientInstance.on).mockImplementation(
      (event: string, cb: (...args: unknown[]) => void) => {
        if (event === 'messageCreate') {
          messageHandler = cb as unknown as (
            message: import('discord.js').Message
          ) => Promise<void>;
        }
        return mockClientInstance as unknown as import('discord.js').Client;
      }
    );

    const { main } = await import('./index.js');
    await main();

    const { isAuthorized } = await import('./config.js');
    vi.mocked(isAuthorized).mockReturnValue(true);

    if (messageHandler) {
      await messageHandler({
        id: 'msg-1',
        author: { id: 'user-123', tag: 'user#1234' } as unknown as import('discord.js').User,
        content: 'message 1',
        guild: null,
        attachments: new Map(),
      } as unknown as import('discord.js').Message);
      await messageHandler({
        id: 'msg-2',
        author: { id: 'user-123', tag: 'user#1234' } as unknown as import('discord.js').User,
        content: 'message 2',
        guild: null,
        attachments: new Map(),
      } as unknown as import('discord.js').Message);
    }

    expect(mockTrpc.sendMessage.mutate).toHaveBeenCalledTimes(2);
    expect(mockTrpc.sendMessage.mutate).toHaveBeenNthCalledWith(1, {
      type: 'send-message',
      client: 'cli',
      data: {
        message: 'message 1',
        chatId: 'default',
        files: undefined,
        adapter: 'discord',
        noWait: true,
      },
    });
    expect(mockTrpc.sendMessage.mutate).toHaveBeenNthCalledWith(2, {
      type: 'send-message',
      client: 'cli',
      data: {
        message: 'message 2',
        chatId: 'default',
        files: undefined,
        adapter: 'discord',
        noWait: true,
      },
    });
  });

  it('should ignore unauthorized messages', async () => {
    let messageHandler: ((message: import('discord.js').Message) => Promise<void>) | undefined;
    vi.mocked(mockClientInstance.on).mockImplementation(
      (event: string, cb: (...args: unknown[]) => void) => {
        if (event === 'messageCreate') {
          messageHandler = cb as unknown as (
            message: import('discord.js').Message
          ) => Promise<void>;
        }
        return mockClientInstance as unknown as import('discord.js').Client;
      }
    );

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
      await messageHandler(mockMessage as unknown as import('discord.js').Message);
    }

    expect(mockTrpc.sendMessage.mutate).not.toHaveBeenCalled();
  });

  it('should download attachments and forward their paths', async () => {
    vi.useFakeTimers();
    let messageHandler: ((message: import('discord.js').Message) => Promise<void>) | undefined;
    vi.mocked(mockClientInstance.on).mockImplementation(
      (event: string, cb: (...args: unknown[]) => void) => {
        if (event === 'messageCreate') {
          messageHandler = cb as unknown as (
            message: import('discord.js').Message
          ) => Promise<void>;
        }
        return mockClientInstance as unknown as import('discord.js').Client;
      }
    );

    const { main } = await import('./index.js');
    await main();

    const { isAuthorized } = await import('./config.js');
    vi.mocked(isAuthorized).mockReturnValue(true);

    const attachments = new Map();
    attachments.set('1', { name: 'test.txt', url: 'http://example.com/test.txt', size: 100 });

    const fsPromises = await import('node:fs/promises');
    vi.spyOn(fsPromises.default, 'mkdir').mockResolvedValue(undefined);
    vi.spyOn(fsPromises.default, 'writeFile').mockResolvedValue(undefined);

    const mockResponse = {
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    } as unknown as Response;
    global.fetch = vi.fn().mockResolvedValue(mockResponse);

    if (messageHandler) {
      await messageHandler({
        author: { id: 'user-123', tag: 'user#1234' } as unknown as import('discord.js').User,
        content: 'Check out this file',
        guild: null,
        attachments,
      } as unknown as import('discord.js').Message);
    }

    // Fast-forward time for debouncer
    await vi.runAllTimersAsync();

    expect(global.fetch).toHaveBeenCalledWith('http://example.com/test.txt');
    expect(fsPromises.default.writeFile).toHaveBeenCalled();

    expect(mockTrpc.sendMessage.mutate).toHaveBeenCalledWith({
      type: 'send-message',
      client: 'cli',
      data: expect.objectContaining({
        message: 'Check out this file',
        chatId: 'default',
        files: expect.arrayContaining([expect.stringContaining('test.txt')]),
      }),
    });

    vi.useRealTimers();
  });

  it('should ignore attachments that exceed the size limit', async () => {
    vi.useFakeTimers();
    let messageHandler: ((message: import('discord.js').Message) => Promise<void>) | undefined;
    vi.mocked(mockClientInstance.on).mockImplementation(
      (event: string, cb: (...args: unknown[]) => void) => {
        if (event === 'messageCreate') {
          messageHandler = cb as unknown as (
            message: import('discord.js').Message
          ) => Promise<void>;
        }
        return mockClientInstance as unknown as import('discord.js').Client;
      }
    );

    const { main } = await import('./index.js');
    await main();

    const { isAuthorized } = await import('./config.js');
    vi.mocked(isAuthorized).mockReturnValue(true);

    const attachments = new Map();
    // 26MB is over the 25MB default
    attachments.set('1', {
      name: 'huge.txt',
      url: 'http://example.com/huge.txt',
      size: 26 * 1024 * 1024 + 1,
    });

    global.fetch = vi.fn();

    const replyMock = vi.fn();

    if (messageHandler) {
      await messageHandler({
        author: { id: 'user-123', tag: 'user#1234' } as unknown as import('discord.js').User,
        content: 'Check out this huge file',
        guild: null,
        attachments,
        reply: replyMock,
      } as unknown as import('discord.js').Message);
    }

    // Fast-forward time for debouncer
    await vi.runAllTimersAsync();

    expect(global.fetch).not.toHaveBeenCalled();
    expect(replyMock).toHaveBeenCalledWith(expect.stringContaining('exceeds the size limit'));

    expect(mockTrpc.sendMessage.mutate).toHaveBeenCalledWith({
      type: 'send-message',
      client: 'cli',
      data: {
        message: 'Check out this huge file',
        chatId: 'default',
        files: undefined, // no files should be attached
        adapter: 'discord',
        noWait: true,
      },
    });

    vi.useRealTimers();
  });

  it('should format message with blockquote when it is a reply', async () => {
    vi.useFakeTimers();
    let messageHandler: ((message: import('discord.js').Message) => Promise<void>) | undefined;
    vi.mocked(mockClientInstance.on).mockImplementation(
      (event: string, cb: (...args: unknown[]) => void) => {
        if (event === 'messageCreate') {
          messageHandler = cb as unknown as (
            message: import('discord.js').Message
          ) => Promise<void>;
        }
        return mockClientInstance as unknown as import('discord.js').Client;
      }
    );

    const { main } = await import('./index.js');
    await main();

    const { isAuthorized } = await import('./config.js');
    vi.mocked(isAuthorized).mockReturnValue(true);

    const mockReferencedMessage = {
      content: 'Would anyone like to get dinner Sunday?\nOr maybe lunch?',
    };

    if (messageHandler) {
      await messageHandler({
        author: { id: 'user-123', tag: 'user#1234' } as unknown as import('discord.js').User,
        content: "Yes, I'm in!",
        guild: null,
        attachments: new Map(),
        reference: { messageId: '12345' },
        fetchReference: vi.fn().mockResolvedValue(mockReferencedMessage),
      } as unknown as import('discord.js').Message);
    }

    // Fast-forward time for debouncer
    await vi.runAllTimersAsync();

    expect(mockTrpc.sendMessage.mutate).toHaveBeenCalledWith({
      type: 'send-message',
      client: 'cli',
      data: {
        message: "> Would anyone like to get dinner Sunday?\n> Or maybe lunch?\nYes, I'm in!",
        chatId: 'default',
        files: undefined,
        adapter: 'discord',
        noWait: true,
      },
    });
    vi.useRealTimers();
  });
});
