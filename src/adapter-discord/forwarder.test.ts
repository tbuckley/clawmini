import { describe, it, expect, vi, beforeEach } from 'vitest';
import { startDaemonToDiscordForwarder } from './forwarder.js';
import { readDiscordState, writeDiscordState } from './state.js';

vi.mock('./state.js', () => ({
  readDiscordState: vi.fn(),
  writeDiscordState: vi.fn(),
}));

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

    vi.mocked(readDiscordState).mockResolvedValue({ lastSyncedMessageId: undefined });
    vi.mocked(writeDiscordState).mockResolvedValue(undefined);
  });

  it('should fetch initial messages if no state exists and start observation loop', async () => {
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

    expect(readDiscordState).toHaveBeenCalled();
    expect(mockTrpc.getMessages.query).toHaveBeenCalledWith({ chatId: 'default', limit: 1 });
    expect(writeDiscordState).toHaveBeenCalledWith({ lastSyncedMessageId: 'msg-1' });
    expect(mockTrpc.waitForMessages.query).toHaveBeenCalledWith({
      chatId: 'default',
      lastMessageId: 'msg-1',
      timeout: 30000,
    });

    expect(mockClient.users.fetch).toHaveBeenCalledWith('user-123');
    expect(mockUser.createDM).toHaveBeenCalled();
    expect(mockDm.send).toHaveBeenCalledWith('Agent response');
    expect(writeDiscordState).toHaveBeenCalledWith({ lastSyncedMessageId: 'msg-2' });
  });

  it('should use stored state if available', async () => {
    const controller = new AbortController();
    vi.mocked(readDiscordState).mockResolvedValue({ lastSyncedMessageId: 'msg-stored' });

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

    expect(mockTrpc.getMessages.query).not.toHaveBeenCalled();
    expect(mockTrpc.waitForMessages.query).toHaveBeenCalledWith({
      chatId: 'default',
      lastMessageId: 'msg-stored',
      timeout: 30000,
    });
  });

  it('should ignore user messages in the observation loop but update state', async () => {
    const controller = new AbortController();
    vi.mocked(readDiscordState).mockResolvedValue({ lastSyncedMessageId: 'msg-0' });

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
    expect(writeDiscordState).toHaveBeenCalledWith({ lastSyncedMessageId: 'msg-1' });
  });

  it('should chunk long messages', async () => {
    const controller = new AbortController();
    const longContent = 'a'.repeat(2500);
    vi.mocked(readDiscordState).mockResolvedValue({ lastSyncedMessageId: 'msg-0' });

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
    expect(writeDiscordState).toHaveBeenCalledWith({ lastSyncedMessageId: 'msg-1' });
  });

  it('should retry with exponential backoff on daemon error', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    vi.mocked(readDiscordState).mockResolvedValue({ lastSyncedMessageId: 'msg-0' });

    // First call fails
    mockTrpc.waitForMessages.query.mockRejectedValueOnce(new Error('Daemon down'));
    // Second call fails
    mockTrpc.waitForMessages.query.mockRejectedValueOnce(new Error('Still down'));
    // Third call succeeds
    mockTrpc.waitForMessages.query.mockResolvedValueOnce([
      {
        id: 'msg-1',
        role: 'log',
        content: 'Finally up',
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

    const forwarderPromise = startDaemonToDiscordForwarder(
      mockClient,
      mockTrpc,
      'user-123',
      'default',
      controller.signal
    );

    // Wait for first error to trigger timeout
    await vi.runAllTimersAsync();
    // Wait for second error to trigger timeout (2000ms)
    await vi.runAllTimersAsync();
    // Success call
    await vi.runAllTimersAsync();

    await forwarderPromise;

    expect(mockTrpc.waitForMessages.query).toHaveBeenCalledTimes(4); // 2 failures + 1 success + 1 abort check
    expect(mockDm.send).toHaveBeenCalledWith('Finally up');
    vi.useRealTimers();
  });
});
