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

vi.mock('./state.js', () => ({
  readDiscordState: vi
    .fn()
    .mockResolvedValue({ channelChatMap: { 'channel-123': { chatId: 'default' } } }),
  updateDiscordState: vi.fn().mockResolvedValue(undefined),
}));

const mockRestPut = vi.fn().mockResolvedValue(true);

vi.mock('discord.js', () => {
  return {
    REST: class {
      setToken = vi.fn().mockReturnThis();
      put = mockRestPut;
    },
    Routes: {
      applicationCommands: vi.fn().mockReturnValue('/mock/commands'),
    },
    Client: class {
      constructor() {
        return mockClientInstance;
      }
    },
    SlashCommandBuilder: class {
      setName = vi.fn().mockReturnThis();
      setDescription = vi.fn().mockReturnThis();
      addStringOption = vi.fn().mockReturnThis();
      toJSON = vi.fn().mockReturnValue({ name: 'mocked_command' });
    },
    Events: {
      ClientReady: 'ready',
      MessageCreate: 'messageCreate',
      InteractionCreate: 'interactionCreate',
    },
    ActionRowBuilder: class {
      addComponents = vi.fn().mockReturnThis();
    },
    ModalBuilder: class {
      setCustomId = vi.fn().mockReturnThis();
      setTitle = vi.fn().mockReturnThis();
      addComponents = vi.fn().mockReturnThis();
    },
    TextInputBuilder: class {
      setCustomId = vi.fn().mockReturnThis();
      setLabel = vi.fn().mockReturnThis();
      setStyle = vi.fn().mockReturnThis();
      setRequired = vi.fn().mockReturnThis();
    },
    TextInputStyle: {
      Paragraph: 2,
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
      waitForMessages: {
        subscribe: vi.fn(),
      },
      waitForTyping: {
        subscribe: vi.fn(),
      },
    } as unknown as ReturnType<typeof import('./client.js').getTRPCClient>;
    vi.mocked(getTRPCClient).mockReturnValue(mockTrpc);
    vi.mocked(readDiscordConfig).mockResolvedValue({
      botToken: 'test-token',
      authorizedUserId: 'user-123',
      chatId: 'default',
      maxAttachmentSizeMB: 25,
      requireMention: false,
    });

    // Reset the mock implementation to return the instance
    vi.mocked(mockClientInstance.on).mockReturnValue(mockClientInstance);
    vi.mocked(mockClientInstance.once).mockReturnValue(mockClientInstance);
  });

  it('should register slash commands on ClientReady', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let readyHandler: ((client: any) => Promise<void>) | undefined;
    vi.mocked(mockClientInstance.once).mockImplementation(
      (event: string, cb: (...args: unknown[]) => void) => {
        if (event === 'ready') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          readyHandler = cb as any;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return mockClientInstance as any;
      }
    );

    const { main } = await import('./index.js');
    await main();

    expect(readyHandler).toBeDefined();

    if (readyHandler) {
      await readyHandler({ user: { id: 'bot-id', tag: 'bot#1234' } });
    }

    const { slashCommands } = await import('./commands.js');

    expect(mockRestPut).toHaveBeenCalledWith('/mock/commands', {
      body: slashCommands.map((cmd) => cmd.toJSON()),
    });
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
      channelId: 'channel-123',
      reply: vi.fn(),
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
        channelId: 'channel-123',
        reply: vi.fn(),
        attachments: new Map(),
      } as unknown as import('discord.js').Message);
      await messageHandler({
        id: 'msg-2',
        author: { id: 'user-123', tag: 'user#1234' } as unknown as import('discord.js').User,
        content: 'message 2',
        guild: null,
        channelId: 'channel-123',
        reply: vi.fn(),
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
      channelId: 'channel-123',
      reply: vi.fn(),
    };

    const { isAuthorized } = await import('./config.js');
    vi.mocked(isAuthorized).mockReturnValue(false);

    if (messageHandler) {
      await messageHandler(mockMessage as unknown as import('discord.js').Message);
    }

    expect(mockTrpc.sendMessage.mutate).not.toHaveBeenCalled();
  });

  it('should process non-DM (guild) messages if requireMention is false', async () => {
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
      author: { id: 'user-123', tag: 'user#1234' },
      content: 'Hack the daemon!',
      guild: { id: 'guild-123' },
      channelId: 'channel-123',
      reply: vi.fn(),
      attachments: new Map(),
    };

    const { isAuthorized } = await import('./config.js');
    vi.mocked(isAuthorized).mockReturnValue(true);

    if (messageHandler) {
      await messageHandler(mockMessage as unknown as import('discord.js').Message);
    }

    expect(mockTrpc.sendMessage.mutate).toHaveBeenCalled();
  });

  it('should NOT process non-DM (guild) messages if channel requireMention is true and not mentioned', async () => {
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
      author: { id: 'user-123', tag: 'user#1234' },
      content: 'Hack the daemon!',
      guild: { id: 'guild-123' },
      channelId: 'channel-123',
      reply: vi.fn(),
      mentions: { has: vi.fn().mockReturnValue(false) },
      attachments: new Map(),
    };

    const { isAuthorized } = await import('./config.js');
    vi.mocked(isAuthorized).mockReturnValue(true);

    const { readDiscordState } = await import('./state.js');
    vi.mocked(readDiscordState).mockResolvedValue({
      channelChatMap: { 'channel-123': { chatId: 'default', requireMention: true } },
    });

    if (messageHandler) {
      await messageHandler(mockMessage as unknown as import('discord.js').Message);
    }

    expect(mockTrpc.sendMessage.mutate).not.toHaveBeenCalled();
  });

  it('should process non-DM (guild) messages if channel requireMention is true and IS mentioned', async () => {
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
      author: { id: 'user-123', tag: 'user#1234' },
      content: 'Hack the daemon!',
      guild: { id: 'guild-123' },
      channelId: 'channel-123',
      reply: vi.fn(),
      mentions: { has: vi.fn().mockReturnValue(true) },
      attachments: new Map(),
    };

    const { isAuthorized } = await import('./config.js');
    vi.mocked(isAuthorized).mockReturnValue(true);

    const { readDiscordState } = await import('./state.js');
    vi.mocked(readDiscordState).mockResolvedValue({
      channelChatMap: { 'channel-123': { chatId: 'default', requireMention: true } },
    });

    if (messageHandler) {
      await messageHandler(mockMessage as unknown as import('discord.js').Message);
    }

    expect(mockTrpc.sendMessage.mutate).toHaveBeenCalled();
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
        channelId: 'channel-123',
        reply: vi.fn(),
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
        channelId: 'channel-123',
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
      author: { id: 'other-user' },
    };

    if (messageHandler) {
      await messageHandler({
        author: { id: 'user-123', tag: 'user#1234' } as unknown as import('discord.js').User,
        content: "Yes, I'm in!",
        guild: null,
        attachments: new Map(),
        channelId: 'channel-123',
        reply: vi.fn(),
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

  describe('Interaction Handling', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let interactionHandler: ((interaction: any) => Promise<void>) | undefined;

    beforeEach(async () => {
      vi.mocked(mockClientInstance.on).mockImplementation(
        (event: string, cb: (...args: unknown[]) => void) => {
          if (event === 'interactionCreate') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            interactionHandler = cb as any;
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return mockClientInstance as any;
        }
      );
      const { main } = await import('./index.js');
      await main();
      const { isAuthorized } = await import('./config.js');
      vi.mocked(isAuthorized).mockReturnValue(true);
    });

    it('should ignore non-button and non-modal interactions', async () => {
      const mockInteraction = {
        isButton: () => false,
        isModalSubmit: () => false,
        isChatInputCommand: () => false,
      };
      if (interactionHandler) await interactionHandler(mockInteraction);
      expect(mockTrpc.sendMessage.mutate).not.toHaveBeenCalled();
    });

    it('should ignore unauthorized interactions', async () => {
      const { isAuthorized } = await import('./config.js');
      vi.mocked(isAuthorized).mockReturnValue(false);
      const mockInteraction = {
        isButton: () => true,
        isModalSubmit: () => false,
        isChatInputCommand: () => false,
        isRepliable: () => true,
        user: { id: 'unauth' },
        reply: vi.fn(),
      };
      if (interactionHandler) await interactionHandler(mockInteraction);
      expect(mockInteraction.reply).toHaveBeenCalledWith({
        content: 'You are not authorized to perform this action.',
        ephemeral: true,
      });
      expect(mockTrpc.sendMessage.mutate).not.toHaveBeenCalled();
    });

    it('should handle approve button interaction', async () => {
      const mockInteraction = {
        isButton: () => true,
        isModalSubmit: () => false,
        isChatInputCommand: () => false,
        user: { id: 'user-123' },
        customId: 'approve_123',
        update: vi.fn(),
        followUp: vi.fn(),
      };
      if (interactionHandler) await interactionHandler(mockInteraction);
      expect(mockInteraction.update).toHaveBeenCalledWith({ components: [] });
      expect(mockInteraction.followUp).toHaveBeenCalledWith({
        content: 'Approving policy 123...',
        ephemeral: true,
      });
      expect(mockTrpc.sendMessage.mutate).toHaveBeenCalledWith({
        type: 'send-message',
        client: 'cli',
        data: {
          message: '/approve 123',
          chatId: 'default',
          adapter: 'discord',
          noWait: true,
        },
      });
    });

    it('should handle reject button interaction by showing a modal', async () => {
      const mockInteraction = {
        isButton: () => true,
        isModalSubmit: () => false,
        isChatInputCommand: () => false,
        user: { id: 'user-123' },
        customId: 'reject_123',
        showModal: vi.fn(),
      };
      if (interactionHandler) await interactionHandler(mockInteraction);
      expect(mockInteraction.showModal).toHaveBeenCalled();
    });

    it('should handle reject modal submit interaction', async () => {
      const mockInteraction = {
        isButton: () => false,
        isModalSubmit: () => true,
        isChatInputCommand: () => false,
        isFromMessage: () => true,
        user: { id: 'user-123' },
        customId: 'modal_reject_123',
        fields: {
          getTextInputValue: vi.fn().mockReturnValue('bad policy'),
        },
        reply: vi.fn(),
        update: vi.fn(),
        followUp: vi.fn(),
      };
      if (interactionHandler) await interactionHandler(mockInteraction);
      expect(mockInteraction.update).toHaveBeenCalledWith({ components: [] });
      expect(mockInteraction.followUp).toHaveBeenCalledWith({
        content: 'Rejecting policy 123...',
        ephemeral: true,
      });
      expect(mockTrpc.sendMessage.mutate).toHaveBeenCalledWith({
        type: 'send-message',
        client: 'cli',
        data: {
          message: '/reject 123 bad policy',
          chatId: 'default',
          adapter: 'discord',
          noWait: true,
        },
      });
    });
  });
});
