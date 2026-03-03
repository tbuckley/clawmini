import { describe, it, expect, vi, beforeEach } from 'vitest';
import { startDaemonToDiscordForwarder } from './forwarder.js';

describe('Daemon to Discord Forwarder', () => {
  let mockClient: any;
  let mockTrpc: any;
  let mockUser: any;
  let mockDm: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockDm = {
      send: vi.fn().mockResolvedValue({}),
    };

    mockUser = {
      createDM: vi.fn().mockResolvedValue(mockDm),
    };

    mockClient = {
      users: {
        fetch: vi.fn().mockResolvedValue(mockUser),
      },
    };

    mockTrpc = {
      getMessages: {
        query: vi.fn().mockResolvedValue([]),
      },
      waitForMessages: {
        query: vi.fn().mockResolvedValue([]),
      },
    };
  });

  it('should fetch initial messages and start observation loop', async () => {
    const controller = new AbortController();

    // Initial messages
    mockTrpc.getMessages.query.mockResolvedValueOnce([
      { id: 'msg-1', role: 'user', content: 'hello', timestamp: '' },
    ]);

    // First waitForMessages call returns a log message
    mockTrpc.waitForMessages.query.mockResolvedValueOnce([
      {
        id: 'msg-2',
        role: 'log',
        content: 'Agent response',
        timestamp: '',
        messageId: 'msg-1',
        command: 'test',
        cwd: '',
        exitCode: 0,
        stderr: '',
      },
    ]);

    // Second waitForMessages call will trigger the abort
    mockTrpc.waitForMessages.query.mockImplementationOnce(async () => {
      controller.abort();
      return [];
    });

    await startDaemonToDiscordForwarder(
      mockClient,
      mockTrpc,
      'user-123',
      'default',
      controller.signal
    );

    expect(mockTrpc.getMessages.query).toHaveBeenCalledWith({ chatId: 'default', limit: 1 });
    expect(mockTrpc.waitForMessages.query).toHaveBeenCalledWith({
      chatId: 'default',
      lastMessageId: 'msg-1',
      timeout: 30000,
    });

    expect(mockClient.users.fetch).toHaveBeenCalledWith('user-123');
    expect(mockUser.createDM).toHaveBeenCalled();
    expect(mockDm.send).toHaveBeenCalledWith('Agent response');
  });

  it('should ignore user messages in the observation loop', async () => {
    const controller = new AbortController();
    mockTrpc.getMessages.query.mockResolvedValueOnce([]);

    mockTrpc.waitForMessages.query.mockResolvedValueOnce([
      { id: 'msg-1', role: 'user', content: 'I should be ignored', timestamp: '' },
    ]);

    mockTrpc.waitForMessages.query.mockImplementationOnce(async () => {
      controller.abort();
      return [];
    });

    await startDaemonToDiscordForwarder(
      mockClient,
      mockTrpc,
      'user-123',
      'default',
      controller.signal
    );

    expect(mockDm.send).not.toHaveBeenCalled();
  });

  it('should chunk long messages', async () => {
    const controller = new AbortController();
    const longContent = 'a'.repeat(2500);
    mockTrpc.getMessages.query.mockResolvedValueOnce([]);

    mockTrpc.waitForMessages.query.mockResolvedValueOnce([
      {
        id: 'msg-1',
        role: 'log',
        content: longContent,
        timestamp: '',
        messageId: 'msg-0',
        command: 'test',
        cwd: '',
        exitCode: 0,
        stderr: '',
      },
    ]);

    mockTrpc.waitForMessages.query.mockImplementationOnce(async () => {
      controller.abort();
      return [];
    });

    await startDaemonToDiscordForwarder(
      mockClient,
      mockTrpc,
      'user-123',
      'default',
      controller.signal
    );

    expect(mockDm.send).toHaveBeenCalledTimes(2);
    expect(mockDm.send).toHaveBeenNthCalledWith(1, 'a'.repeat(2000));
    expect(mockDm.send).toHaveBeenNthCalledWith(2, 'a'.repeat(500));
  });
});
