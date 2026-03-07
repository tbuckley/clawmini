import { describe, it, expect, vi, beforeEach } from 'vitest';
import { startDaemonToDiscordForwarder } from './forwarder.js';
import { readDiscordState, writeDiscordState } from './state.js';

vi.mock('./state.js', () => ({
  readDiscordState: vi.fn(),
  writeDiscordState: vi.fn(),
}));

describe('Daemon to Discord Forwarder', () => {
  let mockClient: import('discord.js').Client;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockTrpc: any;
  let mockUser: import('discord.js').User;
  let mockDm: import('discord.js').DMChannel;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let subscribeCallbacks: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let typingSubscribeCallbacks: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockDm = {
      send: vi.fn().mockResolvedValue({}),
      sendTyping: vi.fn().mockResolvedValue({}),
    } as unknown as import('discord.js').DMChannel;

    mockUser = {
      createDM: vi.fn().mockResolvedValue(mockDm),
    } as unknown as import('discord.js').User;

    mockClient = {
      users: {
        fetch: vi.fn().mockResolvedValue(mockUser),
      },
    } as unknown as import('discord.js').Client;

    subscribeCallbacks = null;
    typingSubscribeCallbacks = null;

    mockTrpc = {
      getMessages: {
        query: vi.fn().mockResolvedValue([]),
      },
      waitForMessages: {
        subscribe: vi.fn().mockImplementation((input, options) => {
          subscribeCallbacks = options;
          return { unsubscribe: vi.fn() };
        }),
      },
      waitForTyping: {
        subscribe: vi.fn().mockImplementation((input, options) => {
          typingSubscribeCallbacks = options;
          return { unsubscribe: vi.fn() };
        }),
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

    const forwarderPromise = startDaemonToDiscordForwarder(
      mockClient,
      mockTrpc,
      'user-123',
      'default',
      controller.signal
    );

    // Wait for the subscribe call
    await vi.waitFor(() => expect(subscribeCallbacks).toBeTruthy());

    expect(readDiscordState).toHaveBeenCalled();
    expect(mockTrpc.getMessages.query).toHaveBeenCalledWith({ chatId: 'default', limit: 1 });
    expect(writeDiscordState).toHaveBeenCalledWith({ lastSyncedMessageId: 'msg-1' });
    expect(mockTrpc.waitForMessages.subscribe).toHaveBeenCalledWith(
      { chatId: 'default', lastMessageId: 'msg-1' },
      expect.any(Object)
    );

    // Trigger onData
    subscribeCallbacks.onData([
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

    // Wait for the async queue processing
    await vi.waitFor(() => expect(mockDm.send).toHaveBeenCalled());

    expect(mockClient.users.fetch).toHaveBeenCalledWith('user-123');
    expect(mockUser.createDM).toHaveBeenCalled();
    expect(mockDm.send).toHaveBeenCalledWith({ content: 'Agent response' });
    expect(writeDiscordState).toHaveBeenCalledWith({ lastSyncedMessageId: 'msg-2' });

    controller.abort();
    await forwarderPromise;
  });

  it('should use stored state if available', async () => {
    const controller = new AbortController();
    vi.mocked(readDiscordState).mockResolvedValue({ lastSyncedMessageId: 'msg-stored' });

    const forwarderPromise = startDaemonToDiscordForwarder(
      mockClient,
      mockTrpc,
      'user-123',
      'default',
      controller.signal
    );

    await vi.waitFor(() => expect(subscribeCallbacks).toBeTruthy());

    expect(mockTrpc.getMessages.query).not.toHaveBeenCalled();
    expect(mockTrpc.waitForMessages.subscribe).toHaveBeenCalledWith(
      { chatId: 'default', lastMessageId: 'msg-stored' },
      expect.any(Object)
    );

    controller.abort();
    await forwarderPromise;
  });

  it('should ignore user messages in the observation loop but update state', async () => {
    const controller = new AbortController();
    vi.mocked(readDiscordState).mockResolvedValue({ lastSyncedMessageId: 'msg-0' });

    const forwarderPromise = startDaemonToDiscordForwarder(
      mockClient,
      mockTrpc,
      'user-123',
      'default',
      controller.signal
    );

    await vi.waitFor(() => expect(subscribeCallbacks).toBeTruthy());

    subscribeCallbacks.onData([
      { id: 'msg-1', role: 'user', content: 'I should be ignored', timestamp: '' },
    ]);

    await vi.waitFor(() =>
      expect(writeDiscordState).toHaveBeenCalledWith({ lastSyncedMessageId: 'msg-1' })
    );

    expect(mockDm.send).not.toHaveBeenCalled();

    controller.abort();
    await forwarderPromise;
  });

  it('should ignore verbose log messages in the observation loop but update state', async () => {
    const controller = new AbortController();
    vi.mocked(readDiscordState).mockResolvedValue({ lastSyncedMessageId: 'msg-0' });

    const forwarderPromise = startDaemonToDiscordForwarder(
      mockClient,
      mockTrpc,
      'user-123',
      'default',
      controller.signal
    );

    await vi.waitFor(() => expect(subscribeCallbacks).toBeTruthy());

    subscribeCallbacks.onData([
      {
        id: 'msg-1',
        role: 'log',
        level: 'verbose',
        content: 'I should be ignored because I am verbose',
        timestamp: '',
        messageId: 'msg-0',
        command: 'test',
        cwd: '',
        exitCode: 0,
        stderr: '',
      },
    ]);

    await vi.waitFor(() =>
      expect(writeDiscordState).toHaveBeenCalledWith({ lastSyncedMessageId: 'msg-1' })
    );

    expect(mockDm.send).not.toHaveBeenCalled();

    controller.abort();
    await forwarderPromise;
  });

  it('should chunk long messages', async () => {
    const controller = new AbortController();
    const longContent = 'a'.repeat(2500);
    vi.mocked(readDiscordState).mockResolvedValue({ lastSyncedMessageId: 'msg-0' });

    const forwarderPromise = startDaemonToDiscordForwarder(
      mockClient,
      mockTrpc,
      'user-123',
      'default',
      controller.signal
    );

    await vi.waitFor(() => expect(subscribeCallbacks).toBeTruthy());

    subscribeCallbacks.onData([
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

    await vi.waitFor(() => expect(mockDm.send).toHaveBeenCalledTimes(2));

    expect(mockDm.send).toHaveBeenNthCalledWith(1, { content: 'a'.repeat(2000) });
    expect(mockDm.send).toHaveBeenNthCalledWith(2, { content: 'a'.repeat(500) });
    expect(writeDiscordState).toHaveBeenCalledWith({ lastSyncedMessageId: 'msg-1' });

    controller.abort();
    await forwarderPromise;
  });

  it('should send file attachments when message includes a file', async () => {
    const controller = new AbortController();
    vi.mocked(readDiscordState).mockResolvedValue({ lastSyncedMessageId: 'msg-0' });

    const forwarderPromise = startDaemonToDiscordForwarder(
      mockClient,
      mockTrpc,
      'user-123',
      'default',
      controller.signal
    );

    await vi.waitFor(() => expect(subscribeCallbacks).toBeTruthy());

    subscribeCallbacks.onData([
      {
        id: 'msg-1',
        role: 'log',
        content: 'Here is your file',
        timestamp: '',
        messageId: 'msg-0',
        command: 'test',
        cwd: '',
        exitCode: 0,
        stderr: '',
        files: ['/path/to/my/file.txt'],
      },
    ]);

    await vi.waitFor(() => expect(mockDm.send).toHaveBeenCalled());

    expect(mockDm.send).toHaveBeenCalledWith({
      content: 'Here is your file',
      files: ['/path/to/my/file.txt'],
    });

    controller.abort();
    await forwarderPromise;
  });

  it('should send ONLY the file attachment when message content is empty', async () => {
    const controller = new AbortController();
    vi.mocked(readDiscordState).mockResolvedValue({ lastSyncedMessageId: 'msg-0' });

    const forwarderPromise = startDaemonToDiscordForwarder(
      mockClient,
      mockTrpc,
      'user-123',
      'default',
      controller.signal
    );

    await vi.waitFor(() => expect(subscribeCallbacks).toBeTruthy());

    subscribeCallbacks.onData([
      {
        id: 'msg-1',
        role: 'log',
        content: '',
        timestamp: '',
        messageId: 'msg-0',
        command: 'test',
        cwd: '',
        exitCode: 0,
        stderr: '',
        files: ['/path/to/my/file.txt'],
      },
    ]);

    await vi.waitFor(() => expect(mockDm.send).toHaveBeenCalled());

    expect(mockDm.send).toHaveBeenCalledWith({
      files: ['/path/to/my/file.txt'],
    });

    controller.abort();
    await forwarderPromise;
  });

  it('should attach the file only to the last chunk when chunking long messages', async () => {
    const controller = new AbortController();
    const longContent = 'a'.repeat(2500);
    vi.mocked(readDiscordState).mockResolvedValue({ lastSyncedMessageId: 'msg-0' });

    const forwarderPromise = startDaemonToDiscordForwarder(
      mockClient,
      mockTrpc,
      'user-123',
      'default',
      controller.signal
    );

    await vi.waitFor(() => expect(subscribeCallbacks).toBeTruthy());

    subscribeCallbacks.onData([
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
        files: ['/path/to/my/file.txt'],
      },
    ]);

    await vi.waitFor(() => expect(mockDm.send).toHaveBeenCalledTimes(2));

    expect(mockDm.send).toHaveBeenNthCalledWith(1, { content: 'a'.repeat(2000) });
    expect(mockDm.send).toHaveBeenNthCalledWith(2, {
      content: 'a'.repeat(500),
      files: ['/path/to/my/file.txt'],
    });

    controller.abort();
    await forwarderPromise;
  });

  it('should retry with exponential backoff on daemon error', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    vi.mocked(readDiscordState).mockResolvedValue({ lastSyncedMessageId: 'msg-0' });

    const forwarderPromise = startDaemonToDiscordForwarder(
      mockClient,
      mockTrpc,
      'user-123',
      'default',
      controller.signal
    );

    await vi.waitFor(() => expect(subscribeCallbacks).toBeTruthy());

    // Capture the first options to trigger an error
    let callbacks = subscribeCallbacks;
    subscribeCallbacks = null;

    // First error
    callbacks.onError(new Error('Daemon down'));
    await vi.runAllTimersAsync();

    // Should have resubscribed
    expect(subscribeCallbacks).toBeTruthy();
    callbacks = subscribeCallbacks;
    subscribeCallbacks = null;

    // Second error
    callbacks.onError(new Error('Still down'));
    await vi.runAllTimersAsync();

    // Should have resubscribed
    expect(subscribeCallbacks).toBeTruthy();
    callbacks = subscribeCallbacks;
    subscribeCallbacks = null;

    // Third call succeeds
    callbacks.onData([
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

    // allow microtasks
    await vi.runAllTimersAsync();

    expect(mockTrpc.waitForMessages.subscribe).toHaveBeenCalledTimes(3);
    expect(mockDm.send).toHaveBeenCalledWith({ content: 'Finally up' });

    controller.abort();
    await forwarderPromise;
    vi.useRealTimers();
  });

  it('should start waitForTyping subscription and call dm.sendTyping on data', async () => {
    const controller = new AbortController();

    const forwarderPromise = startDaemonToDiscordForwarder(
      mockClient,
      mockTrpc,
      'user-123',
      'default',
      controller.signal
    );

    await vi.waitFor(() => expect(typingSubscribeCallbacks).toBeTruthy());

    expect(mockTrpc.waitForTyping.subscribe).toHaveBeenCalledWith(
      { chatId: 'default' },
      expect.any(Object)
    );

    typingSubscribeCallbacks.onData({ chatId: 'default' });

    await vi.waitFor(() => expect(mockDm.sendTyping).toHaveBeenCalled());
    expect(mockClient.users.fetch).toHaveBeenCalledWith('user-123');
    expect(mockUser.createDM).toHaveBeenCalled();

    controller.abort();
    await forwarderPromise;
  });

  it('should retry waitForTyping with exponential backoff on daemon error', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();

    const forwarderPromise = startDaemonToDiscordForwarder(
      mockClient,
      mockTrpc,
      'user-123',
      'default',
      controller.signal
    );

    await vi.waitFor(() => expect(typingSubscribeCallbacks).toBeTruthy());

    let callbacks = typingSubscribeCallbacks;
    typingSubscribeCallbacks = null;

    callbacks.onError(new Error('Daemon down'));
    await vi.runAllTimersAsync();

    expect(typingSubscribeCallbacks).toBeTruthy();
    callbacks = typingSubscribeCallbacks;
    typingSubscribeCallbacks = null;

    callbacks.onError(new Error('Still down'));
    await vi.runAllTimersAsync();

    expect(typingSubscribeCallbacks).toBeTruthy();

    controller.abort();
    await forwarderPromise;
    vi.useRealTimers();
  });
});
