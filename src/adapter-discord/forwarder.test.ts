import { describe, it, expect, vi, beforeEach } from 'vitest';
import { startDaemonToDiscordForwarder } from './forwarder.js';
import { readDiscordState, updateDiscordState } from './state.js';
import { recordInbound, _resetInboundCacheForTests } from './inbound-cache.js';

vi.mock('./state.js', () => ({
  readDiscordState: vi.fn(),
  updateDiscordState: vi.fn(),
  getDiscordStatePath: vi.fn().mockReturnValue('./.tmp-mock-discord/state.json'),
}));

vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(true),
    mkdirSync: vi.fn(),
    watch: vi.fn().mockReturnValue({ close: vi.fn() }),
  },
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
  let mockUpdateDiscordState: import('vitest').Mock;

  beforeEach(() => {
    vi.clearAllMocks();

    mockUpdateDiscordState = vi.fn();
    vi.mocked(updateDiscordState).mockImplementation(async (updates) => {
      const result =
        typeof updates === 'function'
          ? updates({ lastSyncedMessageIds: {} } as import('./state.js').DiscordState)
          : updates;
      mockUpdateDiscordState(result);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return result as any;
    });

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
      channels: {
        fetch: vi.fn(),
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
          // The subscription now yields `ChatStreamItem` envelopes. Tests
          // continue to hand us raw message arrays; wrap them here so each
          // individual test site stays readable. Pre-shaped envelopes
          // (objects with a `kind` field) pass through untouched so tests
          // can also send `{kind:'turn'}` items.
          subscribeCallbacks = {
            onData: (raw: unknown) => {
              if (!Array.isArray(raw)) return options.onData(raw);
              options.onData(
                raw.map((item: unknown) =>
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  item && typeof item === 'object' && 'kind' in (item as any)
                    ? item
                    : { kind: 'message', message: item }
                )
              );
            },
            onError: options.onError,
            onComplete: options.onComplete,
          };
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

    vi.mocked(readDiscordState).mockResolvedValue({});
  });

  it('should fetch initial messages if no state exists and start observation loop', async () => {
    const controller = new AbortController();

    // Initial messages
    mockTrpc.getMessages.query.mockResolvedValueOnce([
      { id: 'msg-1', role: 'user', content: 'hello', timestamp: '' },
    ]);

    const forwarderPromise = startDaemonToDiscordForwarder(mockClient, mockTrpc, 'user-123', {
      chatId: 'default',
      signal: controller.signal,
    });

    // Wait for the subscribe call
    await vi.waitFor(() => expect(subscribeCallbacks).toBeTruthy());

    expect(readDiscordState).toHaveBeenCalled();
    expect(mockTrpc.getMessages.query).toHaveBeenCalledWith({ chatId: 'default', limit: 1 });
    expect(mockUpdateDiscordState).toHaveBeenCalledWith({
      lastSyncedMessageIds: { default: 'msg-1' },
    });
    expect(mockTrpc.waitForMessages.subscribe).toHaveBeenCalledWith(
      { chatId: 'default', lastMessageId: 'msg-1' },
      expect.any(Object)
    );

    // Trigger onData
    subscribeCallbacks.onData([
      {
        id: 'msg-2',
        role: 'agent',
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
    expect(mockDm.send).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Agent response',
        allowedMentions: { parse: [] },
      })
    );
    expect(mockUpdateDiscordState).toHaveBeenCalledWith({
      lastSyncedMessageIds: { default: 'msg-1' },
    });

    controller.abort();
    await forwarderPromise;
  });

  it('should use stored state if available', async () => {
    const controller = new AbortController();
    vi.mocked(readDiscordState).mockResolvedValue({
      lastSyncedMessageIds: { default: 'msg-stored' },
    });

    const forwarderPromise = startDaemonToDiscordForwarder(mockClient, mockTrpc, 'user-123', {
      chatId: 'default',
      signal: controller.signal,
    });

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
    vi.mocked(readDiscordState).mockResolvedValue({ lastSyncedMessageIds: { default: 'msg-0' } });

    const forwarderPromise = startDaemonToDiscordForwarder(mockClient, mockTrpc, 'user-123', {
      chatId: 'default',
      signal: controller.signal,
    });

    await vi.waitFor(() => expect(subscribeCallbacks).toBeTruthy());

    subscribeCallbacks.onData([
      { id: 'msg-1', role: 'user', content: 'I should be ignored', timestamp: '' },
    ]);

    await vi.waitFor(() =>
      expect(mockUpdateDiscordState).toHaveBeenCalledWith({
        lastSyncedMessageIds: { default: 'msg-1' },
      })
    );

    expect(mockDm.send).not.toHaveBeenCalled();

    controller.abort();
    await forwarderPromise;
  });

  it('should ignore verbose log messages in the observation loop but update state', async () => {
    const controller = new AbortController();
    vi.mocked(readDiscordState).mockResolvedValue({ lastSyncedMessageIds: { default: 'msg-0' } });

    const forwarderPromise = startDaemonToDiscordForwarder(mockClient, mockTrpc, 'user-123', {
      chatId: 'default',
      signal: controller.signal,
    });

    await vi.waitFor(() => expect(subscribeCallbacks).toBeTruthy());

    subscribeCallbacks.onData([
      {
        id: 'msg-1',
        role: 'legacy_log',
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
      expect(mockUpdateDiscordState).toHaveBeenCalledWith({
        lastSyncedMessageIds: { default: 'msg-1' },
      })
    );

    expect(mockDm.send).not.toHaveBeenCalled();

    controller.abort();
    await forwarderPromise;
  });

  it('should chunk long messages', async () => {
    const controller = new AbortController();
    const longContent = 'a'.repeat(2500);
    vi.mocked(readDiscordState).mockResolvedValue({ lastSyncedMessageIds: { default: 'msg-0' } });

    const forwarderPromise = startDaemonToDiscordForwarder(mockClient, mockTrpc, 'user-123', {
      chatId: 'default',
      signal: controller.signal,
    });

    await vi.waitFor(() => expect(subscribeCallbacks).toBeTruthy());

    subscribeCallbacks.onData([
      {
        id: 'msg-1',
        role: 'agent',
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

    expect(mockDm.send).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        content: 'a'.repeat(2000),
        allowedMentions: { parse: [] },
      })
    );
    expect(mockDm.send).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        content: 'a'.repeat(500),
        allowedMentions: { parse: [] },
      })
    );
    expect(mockUpdateDiscordState).toHaveBeenCalledWith({
      lastSyncedMessageIds: { default: 'msg-1' },
    });

    controller.abort();
    await forwarderPromise;
  });

  it('should send file attachments when message includes a file', async () => {
    const controller = new AbortController();
    vi.mocked(readDiscordState).mockResolvedValue({ lastSyncedMessageIds: { default: 'msg-0' } });

    const forwarderPromise = startDaemonToDiscordForwarder(mockClient, mockTrpc, 'user-123', {
      chatId: 'default',
      signal: controller.signal,
    });

    await vi.waitFor(() => expect(subscribeCallbacks).toBeTruthy());

    subscribeCallbacks.onData([
      {
        id: 'msg-1',
        role: 'agent',
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

    expect(mockDm.send).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Here is your file',
        files: ['/path/to/my/file.txt'],
        allowedMentions: { parse: [] },
      })
    );

    controller.abort();
    await forwarderPromise;
  });

  it('should send ONLY the file attachment when message content is empty', async () => {
    const controller = new AbortController();
    vi.mocked(readDiscordState).mockResolvedValue({ lastSyncedMessageIds: { default: 'msg-0' } });

    const forwarderPromise = startDaemonToDiscordForwarder(mockClient, mockTrpc, 'user-123', {
      chatId: 'default',
      signal: controller.signal,
    });

    await vi.waitFor(() => expect(subscribeCallbacks).toBeTruthy());

    subscribeCallbacks.onData([
      {
        id: 'msg-1',
        role: 'agent',
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

    expect(mockDm.send).toHaveBeenCalledWith(
      expect.objectContaining({
        files: ['/path/to/my/file.txt'],
        allowedMentions: { parse: [] },
      })
    );

    controller.abort();
    await forwarderPromise;
  });

  it('should attach the file only to the last chunk when chunking long messages', async () => {
    const controller = new AbortController();
    const longContent = 'a'.repeat(2500);
    vi.mocked(readDiscordState).mockResolvedValue({ lastSyncedMessageIds: { default: 'msg-0' } });

    const forwarderPromise = startDaemonToDiscordForwarder(mockClient, mockTrpc, 'user-123', {
      chatId: 'default',
      signal: controller.signal,
    });

    await vi.waitFor(() => expect(subscribeCallbacks).toBeTruthy());

    subscribeCallbacks.onData([
      {
        id: 'msg-1',
        role: 'agent',
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

    expect(mockDm.send).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        content: 'a'.repeat(2000),
        allowedMentions: { parse: [] },
      })
    );
    expect(mockDm.send).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        content: 'a'.repeat(500),
        files: ['/path/to/my/file.txt'],
        allowedMentions: { parse: [] },
      })
    );

    controller.abort();
    await forwarderPromise;
  });

  it('should retry with exponential backoff on daemon error', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    vi.mocked(readDiscordState).mockResolvedValue({ lastSyncedMessageIds: { default: 'msg-0' } });

    const forwarderPromise = startDaemonToDiscordForwarder(mockClient, mockTrpc, 'user-123', {
      chatId: 'default',
      signal: controller.signal,
    });

    await vi.waitFor(() => expect(subscribeCallbacks).toBeTruthy());

    // Capture the first options to trigger an error
    let callbacks = subscribeCallbacks;
    subscribeCallbacks = null;

    // First error
    callbacks.onError(new Error('Daemon down'));
    await vi.advanceTimersByTimeAsync(30000);

    // Should have resubscribed
    expect(subscribeCallbacks).toBeTruthy();
    callbacks = subscribeCallbacks;
    subscribeCallbacks = null;

    // Second error
    callbacks.onError(new Error('Still down'));
    await vi.advanceTimersByTimeAsync(30000);

    // Should have resubscribed
    expect(subscribeCallbacks).toBeTruthy();
    callbacks = subscribeCallbacks;
    subscribeCallbacks = null;

    // Third call succeeds
    callbacks.onData([
      {
        id: 'msg-1',
        role: 'agent',
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
    await vi.advanceTimersByTimeAsync(30000);

    expect(mockTrpc.waitForMessages.subscribe).toHaveBeenCalledTimes(3);
    expect(mockDm.send).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Finally up',
        allowedMentions: { parse: [] },
      })
    );

    controller.abort();
    await forwarderPromise;
    vi.useRealTimers();
  });

  it('should start waitForTyping subscription and call dm.sendTyping on data', async () => {
    const controller = new AbortController();

    const forwarderPromise = startDaemonToDiscordForwarder(mockClient, mockTrpc, 'user-123', {
      chatId: 'default',
      signal: controller.signal,
    });

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

    const forwarderPromise = startDaemonToDiscordForwarder(mockClient, mockTrpc, 'user-123', {
      chatId: 'default',
      signal: controller.signal,
    });

    await vi.waitFor(() => expect(typingSubscribeCallbacks).toBeTruthy());

    let callbacks = typingSubscribeCallbacks;
    typingSubscribeCallbacks = null;

    callbacks.onError(new Error('Daemon down'));
    await vi.advanceTimersByTimeAsync(30000);

    expect(typingSubscribeCallbacks).toBeTruthy();
    callbacks = typingSubscribeCallbacks;
    typingSubscribeCallbacks = null;

    callbacks.onError(new Error('Still down'));
    await vi.advanceTimersByTimeAsync(30000);

    expect(typingSubscribeCallbacks).toBeTruthy();

    controller.abort();
    await forwarderPromise;
    vi.useRealTimers();
  });

  it('should format and forward pending policy requests', async () => {
    const controller = new AbortController();
    vi.mocked(readDiscordState).mockResolvedValue({ lastSyncedMessageIds: { default: 'msg-0' } });

    const forwarderPromise = startDaemonToDiscordForwarder(mockClient, mockTrpc, 'user-123', {
      chatId: 'default',
      signal: controller.signal,
    });

    await vi.waitFor(() => expect(subscribeCallbacks).toBeTruthy());

    subscribeCallbacks.onData([
      {
        id: 'msg-1',
        role: 'policy',
        status: 'pending',
        content: 'Please approve this',
        timestamp: '',
        messageId: 'msg-0',
        command: 'test',
        cwd: '',
        exitCode: 0,
        stderr: '',
      },
    ]);

    await vi.waitFor(() => expect(mockDm.send).toHaveBeenCalled());

    expect(mockDm.send).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.any(Array),
        components: expect.any(Array),
      })
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const callArgs = vi.mocked(mockDm.send).mock.calls[0]?.[0] as any;
    expect(callArgs.embeds[0].data.title).toBe('Action Required: Policy Request');
    expect(callArgs.embeds[0].data.description).toBe('Please approve this');
    expect(callArgs.components[0].components[0].data.custom_id).toBe('approve|msg-1|default');
    expect(callArgs.components[0].components[1].data.custom_id).toBe('reject|msg-1|default');

    expect(mockUpdateDiscordState).toHaveBeenCalledWith({
      lastSyncedMessageIds: { default: 'msg-1' },
    });

    controller.abort();
    await forwarderPromise;
  });

  it('should fallback to plain text if rich message fails for policy request', async () => {
    const controller = new AbortController();
    vi.mocked(readDiscordState).mockResolvedValue({ lastSyncedMessageIds: { default: 'msg-0' } });

    // Mock DM failure for first call (embeds), success for second (plain text)
    mockDm.send = vi
      .fn()
      .mockRejectedValueOnce(new Error('Cannot send embeds'))
      .mockResolvedValueOnce({});

    const forwarderPromise = startDaemonToDiscordForwarder(mockClient, mockTrpc, 'user-123', {
      chatId: 'default',
      signal: controller.signal,
    });

    await vi.waitFor(() => expect(subscribeCallbacks).toBeTruthy());

    subscribeCallbacks.onData([
      {
        id: 'msg-1',
        role: 'policy',
        status: 'pending',
        content: 'Please approve this',
        timestamp: '',
        messageId: 'msg-0',
        command: 'test',
        cwd: '',
        exitCode: 0,
        stderr: '',
      },
    ]);

    await vi.waitFor(() => expect(mockDm.send).toHaveBeenCalledTimes(2));

    expect(mockDm.send).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        content:
          'Action Required: Policy Request\n\nPlease approve this\n\nApprove: `/approve msg-1`\nReject: `/reject msg-1 <optional_rationale>`',
        allowedMentions: { parse: [] },
      })
    );

    // Should still update state to avoid infinite loop
    expect(mockUpdateDiscordState).toHaveBeenCalledWith({
      lastSyncedMessageIds: { default: 'msg-1' },
    });

    controller.abort();
    await forwarderPromise;
  });

  it('should prioritize local memory over disk state during syncSubscriptions polling', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();

    const forwarderPromise = startDaemonToDiscordForwarder(mockClient, mockTrpc, 'user-123', {
      chatId: 'default',
      signal: controller.signal,
    });

    // Initial sync is called immediately without timers
    await vi.runAllTicks();

    await vi.waitFor(() => expect(subscribeCallbacks).toBeTruthy(), { timeout: 1000 });

    // Send a message, this updates the local memory cache to msg-local
    subscribeCallbacks.onData([
      { id: 'msg-local', role: 'agent', content: 'Agent response', timestamp: '' },
    ]);

    await vi.waitFor(
      () =>
        expect(mockUpdateDiscordState).toHaveBeenCalledWith(
          expect.objectContaining({ lastSyncedMessageIds: { default: 'msg-local' } })
        ),
      { timeout: 1000 }
    );

    // Simulate disk change where read state returns an older message ID
    vi.mocked(readDiscordState).mockResolvedValueOnce({
      lastSyncedMessageIds: { default: 'msg-stale', otherChat: 'msg-other' },
    });

    // Trigger fs.watch callback
    const fsWatchMock = (await import('node:fs')).default.watch as import('vitest').Mock;
    const watchCallback = fsWatchMock.mock.calls[0]![1];
    watchCallback('change', 'state.json');

    vi.advanceTimersByTime(250);

    // Wait for the async syncSubscriptions to finish
    await vi.runAllTicks();

    subscribeCallbacks.onData([
      { id: 'msg-latest', role: 'agent', content: 'Agent response 2', timestamp: '' },
    ]);

    await vi.waitFor(
      () =>
        expect(mockUpdateDiscordState).toHaveBeenCalledWith(
          expect.objectContaining({
            lastSyncedMessageIds: { default: 'msg-latest', otherChat: 'msg-other' },
          })
        ),
      { timeout: 1000 }
    );

    vi.useRealTimers();
    controller.abort();
    await forwarderPromise;
  });

  it('should use mapped channel ID from state if it exists', async () => {
    const controller = new AbortController();
    vi.mocked(readDiscordState).mockResolvedValue({
      lastSyncedMessageIds: { 'mapped-chat': 'msg-0' },
      channelChatMap: { 'channel-123': { chatId: 'mapped-chat' } },
    });

    const mockChannel = {
      isTextBased: () => true,
      isDMBased: () => false,
      send: vi.fn().mockResolvedValue({}),
    };
    mockClient.channels.fetch = vi.fn().mockResolvedValue(mockChannel);

    const forwarderPromise = startDaemonToDiscordForwarder(mockClient, mockTrpc, 'user-123', {
      chatId: 'mapped-chat',
      signal: controller.signal,
    });

    await vi.waitFor(() => expect(subscribeCallbacks).toBeTruthy());

    subscribeCallbacks.onData([
      { id: 'msg-1', role: 'agent', content: 'hello mapped', timestamp: '' },
    ]);

    await vi.waitFor(() => expect(mockChannel.send).toHaveBeenCalled());

    expect(mockClient.channels.fetch).toHaveBeenCalledWith('channel-123');

    controller.abort();
    await forwarderPromise;
  });

  describe('turn-log threading', () => {
    let mockChannel: {
      isTextBased: () => boolean;
      isDMBased: () => boolean;
      isThread: () => boolean;
      send: import('vitest').Mock;
      messages: { fetch: import('vitest').Mock };
    };
    let mockUserMessage: {
      startThread: import('vitest').Mock;
    };
    let mockThread: {
      id: string;
      send: import('vitest').Mock;
      messages: { fetch: import('vitest').Mock };
    };
    let mockLogMessage: { id: string; edit: import('vitest').Mock };

    beforeEach(() => {
      _resetInboundCacheForTests();

      mockLogMessage = {
        id: 'log-msg-1',
        edit: vi.fn().mockResolvedValue({}),
      };
      mockThread = {
        id: 'thread-1',
        send: vi.fn().mockResolvedValue({ id: 'log-msg-1' }),
        messages: {
          fetch: vi.fn().mockResolvedValue(mockLogMessage),
        },
      };
      mockUserMessage = {
        startThread: vi.fn().mockResolvedValue(mockThread),
      };
      mockChannel = {
        isTextBased: () => true,
        isDMBased: () => false,
        isThread: () => false,
        send: vi.fn().mockResolvedValue({}),
        messages: {
          fetch: vi.fn().mockResolvedValue(mockUserMessage),
        },
      };
      mockClient.channels.fetch = vi.fn().mockResolvedValue(mockChannel);

      vi.mocked(readDiscordState).mockResolvedValue({
        lastSyncedMessageIds: { 'mapped-chat': 'msg-0' },
        channelChatMap: { 'channel-123': { chatId: 'mapped-chat' } },
      });
    });

    it('opens a thread on the user message and posts the activity log entry', async () => {
      vi.useFakeTimers();
      const controller = new AbortController();
      recordInbound({ messageId: 'inbound-1', channelId: 'channel-123' });

      const forwarderPromise = startDaemonToDiscordForwarder(mockClient, mockTrpc, 'user-123', {
        chatId: 'mapped-chat',
        signal: controller.signal,
      });

      await vi.waitFor(() => expect(subscribeCallbacks).toBeTruthy());

      subscribeCallbacks.onData([
        {
          kind: 'turn',
          event: {
            type: 'started',
            turnId: 'turn-1',
            rootMessageId: 'msg-1',
            externalRef: 'inbound-1',
          },
        },
        {
          kind: 'message',
          message: {
            id: 'msg-2',
            role: 'tool',
            name: 'Read',
            payload: { file_path: '/foo/bar.txt' },
            timestamp: '',
            turnId: 'turn-1',
          },
        },
      ]);

      await vi.runOnlyPendingTimersAsync();
      await vi.advanceTimersByTimeAsync(1500);
      await vi.runOnlyPendingTimersAsync();

      expect(mockUserMessage.startThread).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Activity log' })
      );
      // Initial flush posts the "Started processing…" entry; coalesced flush
      // adds the tool entry. We assert the tool entry made it into a posted
      // message.
      const sentTexts = mockThread.send.mock.calls.map((c) => c[0]?.content as string);
      const editedTexts = mockLogMessage.edit.mock.calls.map((c) => c[0]?.content as string);
      const allTexts = [...sentTexts, ...editedTexts];
      expect(allTexts.some((t) => t.includes('Started processing'))).toBe(true);
      expect(allTexts.some((t) => t.includes('/foo/bar.txt'))).toBe(true);

      controller.abort();
      vi.useRealTimers();
      await forwarderPromise;
    });

    it('does not open a thread when the inbound is missing (no cached anchor)', async () => {
      const controller = new AbortController();

      const forwarderPromise = startDaemonToDiscordForwarder(mockClient, mockTrpc, 'user-123', {
        chatId: 'mapped-chat',
        signal: controller.signal,
      });

      await vi.waitFor(() => expect(subscribeCallbacks).toBeTruthy());

      subscribeCallbacks.onData([
        {
          kind: 'turn',
          event: {
            type: 'started',
            turnId: 'turn-1',
            rootMessageId: 'msg-1',
            externalRef: 'unknown-inbound',
          },
        },
        {
          kind: 'message',
          message: {
            id: 'msg-2',
            role: 'tool',
            name: 'Read',
            payload: { file_path: '/foo/bar.txt' },
            timestamp: '',
            turnId: 'turn-1',
          },
        },
        {
          kind: 'turn',
          event: { type: 'ended', turnId: 'turn-1', outcome: 'ok' },
        },
      ]);

      await vi.waitFor(() =>
        expect(mockUpdateDiscordState).toHaveBeenCalledWith({
          lastSyncedMessageIds: { 'mapped-chat': 'msg-2' },
        })
      );

      expect(mockUserMessage.startThread).not.toHaveBeenCalled();
      expect(mockThread.send).not.toHaveBeenCalled();

      controller.abort();
      await forwarderPromise;
    });

    it('drops thread-log activity when visibility.threads is false', async () => {
      vi.useFakeTimers();
      const controller = new AbortController();
      recordInbound({ messageId: 'inbound-1', channelId: 'channel-123' });

      const forwarderPromise = startDaemonToDiscordForwarder(mockClient, mockTrpc, 'user-123', {
        chatId: 'mapped-chat',
        signal: controller.signal,
        discordConfig: {
          botToken: 't',
          authorizedUserId: 'user-123',
          chatId: 'mapped-chat',
          maxAttachmentSizeMB: 25,
          requireMention: false,
          visibility: { threads: false },
        },
      });

      await vi.waitFor(() => expect(subscribeCallbacks).toBeTruthy());

      subscribeCallbacks.onData([
        {
          kind: 'turn',
          event: {
            type: 'started',
            turnId: 'turn-1',
            rootMessageId: 'msg-1',
            externalRef: 'inbound-1',
          },
        },
        {
          kind: 'message',
          message: {
            id: 'msg-2',
            role: 'tool',
            name: 'Read',
            payload: { file_path: '/foo/bar.txt' },
            timestamp: '',
            turnId: 'turn-1',
          },
        },
      ]);

      await vi.advanceTimersByTimeAsync(1500);
      await vi.runOnlyPendingTimersAsync();

      expect(mockUserMessage.startThread).not.toHaveBeenCalled();
      expect(mockThread.send).not.toHaveBeenCalled();

      controller.abort();
      vi.useRealTimers();
      await forwarderPromise;
    });

    it('drops thread-log activity when the channel has threadsDisabled', async () => {
      vi.useFakeTimers();
      const controller = new AbortController();
      recordInbound({ messageId: 'inbound-1', channelId: 'channel-123' });

      vi.mocked(readDiscordState).mockResolvedValue({
        lastSyncedMessageIds: { 'mapped-chat': 'msg-0' },
        channelChatMap: {
          'channel-123': { chatId: 'mapped-chat', threadsDisabled: true },
        },
      });

      const forwarderPromise = startDaemonToDiscordForwarder(mockClient, mockTrpc, 'user-123', {
        chatId: 'mapped-chat',
        signal: controller.signal,
      });

      await vi.waitFor(() => expect(subscribeCallbacks).toBeTruthy());

      subscribeCallbacks.onData([
        {
          kind: 'turn',
          event: {
            type: 'started',
            turnId: 'turn-1',
            rootMessageId: 'msg-1',
            externalRef: 'inbound-1',
          },
        },
        {
          kind: 'message',
          message: {
            id: 'msg-2',
            role: 'tool',
            name: 'Read',
            payload: { file_path: '/foo/bar.txt' },
            timestamp: '',
            turnId: 'turn-1',
          },
        },
      ]);

      await vi.advanceTimersByTimeAsync(1500);
      await vi.runOnlyPendingTimersAsync();

      expect(mockUserMessage.startThread).not.toHaveBeenCalled();
      expect(mockThread.send).not.toHaveBeenCalled();

      controller.abort();
      vi.useRealTimers();
      await forwarderPromise;
    });

    it('reuses an existing thread when the user message already has one', async () => {
      vi.useFakeTimers();
      const controller = new AbortController();
      recordInbound({ messageId: 'inbound-1', channelId: 'channel-123' });

      mockUserMessage = {
        startThread: vi.fn(),
        hasThread: true,
        thread: mockThread,
      } as unknown as typeof mockUserMessage;
      mockChannel.messages.fetch = vi.fn().mockResolvedValue(mockUserMessage);

      const forwarderPromise = startDaemonToDiscordForwarder(mockClient, mockTrpc, 'user-123', {
        chatId: 'mapped-chat',
        signal: controller.signal,
      });

      await vi.waitFor(() => expect(subscribeCallbacks).toBeTruthy());

      subscribeCallbacks.onData([
        {
          kind: 'turn',
          event: {
            type: 'started',
            turnId: 'turn-1',
            rootMessageId: 'msg-1',
            externalRef: 'inbound-1',
          },
        },
      ]);

      await vi.advanceTimersByTimeAsync(1500);
      await vi.runOnlyPendingTimersAsync();

      expect(mockUserMessage.startThread).not.toHaveBeenCalled();
      expect(mockThread.send).toHaveBeenCalled();

      controller.abort();
      vi.useRealTimers();
      await forwarderPromise;
    });

    it('recovers when startThread races with another caller (160004)', async () => {
      vi.useFakeTimers();
      const controller = new AbortController();
      recordInbound({ messageId: 'inbound-1', channelId: 'channel-123' });

      const raceErr: Error & { code?: number } = new Error(
        'A thread has already been created for this message'
      );
      raceErr.code = 160004;
      mockUserMessage = {
        startThread: vi.fn().mockRejectedValue(raceErr),
        hasThread: false,
        thread: null,
      } as unknown as typeof mockUserMessage;
      mockChannel.messages.fetch = vi
        .fn()
        // Initial fetch: no thread yet.
        .mockResolvedValueOnce(mockUserMessage)
        // Refetch after 160004: thread now exists.
        .mockResolvedValueOnce({
          startThread: vi.fn(),
          hasThread: true,
          thread: mockThread,
        });

      const forwarderPromise = startDaemonToDiscordForwarder(mockClient, mockTrpc, 'user-123', {
        chatId: 'mapped-chat',
        signal: controller.signal,
      });

      await vi.waitFor(() => expect(subscribeCallbacks).toBeTruthy());

      subscribeCallbacks.onData([
        {
          kind: 'turn',
          event: {
            type: 'started',
            turnId: 'turn-1',
            rootMessageId: 'msg-1',
            externalRef: 'inbound-1',
          },
        },
      ]);

      await vi.advanceTimersByTimeAsync(1500);
      await vi.runOnlyPendingTimersAsync();

      expect(mockUserMessage.startThread).toHaveBeenCalled();
      expect(mockChannel.messages.fetch).toHaveBeenCalledTimes(2);
      expect(mockThread.send).toHaveBeenCalled();

      controller.abort();
      vi.useRealTimers();
      await forwarderPromise;
    });

    it('routes the final agent reply top-level, not into the thread', async () => {
      vi.useFakeTimers();
      const controller = new AbortController();
      recordInbound({ messageId: 'inbound-1', channelId: 'channel-123' });

      const forwarderPromise = startDaemonToDiscordForwarder(mockClient, mockTrpc, 'user-123', {
        chatId: 'mapped-chat',
        signal: controller.signal,
      });

      await vi.waitFor(() => expect(subscribeCallbacks).toBeTruthy());

      subscribeCallbacks.onData([
        {
          kind: 'turn',
          event: {
            type: 'started',
            turnId: 'turn-1',
            rootMessageId: 'msg-1',
            externalRef: 'inbound-1',
          },
        },
        {
          kind: 'message',
          message: {
            id: 'msg-final',
            role: 'agent',
            content: 'Final reply',
            timestamp: '',
            turnId: 'turn-1',
          },
        },
      ]);

      await vi.advanceTimersByTimeAsync(1500);
      await vi.runOnlyPendingTimersAsync();

      expect(mockChannel.send).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'Final reply',
          allowedMentions: { parse: [] },
        })
      );
      // The thread itself doesn't carry the agent reply.
      const threadBody = mockThread.send.mock.calls.map((c) => c[0]?.content as string).join('\n');
      expect(threadBody).not.toContain('Final reply');

      controller.abort();
      vi.useRealTimers();
      await forwarderPromise;
    });
  });
});
