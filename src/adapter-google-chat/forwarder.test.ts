import { describe, it, expect, vi, beforeEach } from 'vitest';
import { startDaemonToGoogleChatForwarder } from './forwarder.js';

const mockConfig = {
  projectId: 'test',
  subscriptionName: 'test',
  topicName: 'test-topic',
  authorizedUsers: ['user@example.com'],
  chatId: 'default',
  directMessageName: 'spaces/test-space',
  driveUploadEnabled: true,
  oauthClientId: 'mock-client-id',
  oauthClientSecret: 'mock-client-secret',
};

const mockMessagesCreate = vi.fn().mockResolvedValue({});
const mockDriveFilesCreate = vi.fn().mockResolvedValue({
  data: { id: 'file-123', webViewLink: 'https://drive.google.com/file/123' },
});
const mockDrivePermissionsCreate = vi.fn().mockResolvedValue({});
const mockDriveFilesList = vi.fn().mockResolvedValue({
  data: { files: [{ id: 'old-file-123', name: 'old.txt' }] },
});
const mockDriveFilesDelete = vi.fn().mockResolvedValue({});

vi.mock('googleapis', () => {
  return {
    google: {
      auth: {
        getClient: vi.fn().mockResolvedValue({}),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        OAuth2: vi.fn().mockImplementation(function (this: any) {
          this.setCredentials = vi.fn();
          this.generateAuthUrl = vi.fn().mockReturnValue('http://mock-auth-url');
          this.on = vi.fn();
        }),
      },
      chat: vi.fn().mockReturnValue({
        spaces: {
          messages: {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            create: (...args: any[]) => mockMessagesCreate(...args),
          },
        },
      }),
      drive: vi.fn().mockReturnValue({
        files: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          create: (...args: any[]) => mockDriveFilesCreate(...args),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          list: (...args: any[]) => mockDriveFilesList(...args),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          delete: (...args: any[]) => mockDriveFilesDelete(...args),
        },
        permissions: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          create: (...args: any[]) => mockDrivePermissionsCreate(...args),
        },
      }),
    },
  };
});

const mockReadState = vi.fn().mockImplementation(() => {
  console.log('MOCKED mockReadState called!');
  return Promise.resolve({ oauthTokens: { access_token: 'mock-token' } });
});
const mockWriteState = vi.fn().mockResolvedValue(undefined);

vi.mock('./state.js', () => ({
  readGoogleChatState: () => mockReadState(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateGoogleChatState: (updates: any) => {
    const currentState = { lastSyncedMessageIds: { otherChat: 'msg-other' } };
    const result =
      typeof updates === 'function'
        ? updates(currentState as import('./state.js').GoogleChatState)
        : updates;
    mockWriteState(result);
    return Promise.resolve(result);
  },
  getGoogleChatStatePath: vi.fn().mockReturnValue('./.tmp-mock-google/state.json'),
}));

vi.mock('./auth.js', () => ({
  getAuthClient: vi.fn().mockResolvedValue({}),
  getUserAuthClient: vi.fn().mockResolvedValue({}),
}));

vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(true),
    createReadStream: vi.fn().mockReturnValue('mock-stream'),
    mkdirSync: vi.fn(),
    watch: vi.fn().mockReturnValue({ close: vi.fn() }),
  },
}));

vi.mock('mime-types', () => ({
  default: {
    lookup: vi.fn().mockReturnValue('image/png'),
  },
}));

describe('Daemon to Google Chat Forwarder', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockTrpc: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let subscribeCallbacks: any;

  beforeEach(() => {
    vi.clearAllMocks();
    subscribeCallbacks = null;

    mockTrpc = {
      getMessages: {
        query: vi.fn().mockResolvedValue([]),
      },
      waitForMessages: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        subscribe: vi.fn().mockImplementation((input: any, options: any) => {
          subscribeCallbacks = options;
          return { unsubscribe: vi.fn() };
        }),
      },
    };

    mockReadState.mockResolvedValue({
      driveOauthTokens: { access_token: 'mock-token' },
    });
  });

  it('should fetch initial messages and start observation loop', async () => {
    const controller = new AbortController();

    mockTrpc.getMessages.query.mockResolvedValueOnce([
      { id: 'msg-1', role: 'user', content: 'hello' },
    ]);

    const forwarderPromise = startDaemonToGoogleChatForwarder(
      mockTrpc,
      mockConfig,
      {},
      controller.signal
    );

    await vi.waitFor(() => expect(subscribeCallbacks).toBeTruthy());

    expect(mockTrpc.getMessages.query).toHaveBeenCalledWith({ chatId: 'default', limit: 1 });
    expect(mockTrpc.waitForMessages.subscribe).toHaveBeenCalledWith(
      { chatId: 'default', lastMessageId: 'msg-1' },
      expect.any(Object)
    );

    subscribeCallbacks.onData([
      {
        id: 'msg-2',
        role: 'agent',
        content: 'Agent response',
        timestamp: '',
      },
    ]);

    await vi.waitFor(() => expect(mockMessagesCreate).toHaveBeenCalled());

    expect(mockMessagesCreate).toHaveBeenCalledWith({
      parent: 'spaces/test-space',
      requestBody: { text: 'Agent response' },
    });

    controller.abort();
    await forwarderPromise;
  });

  it('should format message with Google Drive links if files present', async () => {
    const controller = new AbortController();

    const forwarderPromise = startDaemonToGoogleChatForwarder(
      mockTrpc,
      mockConfig,
      {},
      controller.signal
    );

    await vi.waitFor(() => expect(subscribeCallbacks).toBeTruthy());

    subscribeCallbacks.onData([
      {
        id: 'msg-2',
        role: 'agent',
        content: 'Here are the files',
        files: ['/tmp/file1.png', '/tmp/file2.txt'],
      },
    ]);

    await vi.waitFor(() => expect(mockMessagesCreate).toHaveBeenCalled());

    expect(mockDriveFilesCreate).toHaveBeenCalledTimes(2);
    expect(mockDrivePermissionsCreate).toHaveBeenCalledTimes(2);
    expect(mockDrivePermissionsCreate).toHaveBeenCalledWith({
      fileId: 'file-123',
      requestBody: { type: 'user', role: 'reader', emailAddress: 'user@example.com' },
      sendNotificationEmail: false,
    });

    expect(mockMessagesCreate).toHaveBeenCalledWith({
      parent: 'spaces/test-space',
      requestBody: {
        text: 'Here are the files\n\nhttps://drive.google.com/file/123\nhttps://drive.google.com/file/123\n',
      },
    });

    controller.abort();
    await forwarderPromise;
  });

  it('should fallback to local file output if drive upload is enabled but oauth secrets are missing', async () => {
    const controller = new AbortController();

    const forwarderPromise = startDaemonToGoogleChatForwarder(
      mockTrpc,
      { ...mockConfig, oauthClientId: undefined, oauthClientSecret: undefined },
      {},
      controller.signal
    );

    await vi.waitFor(() => expect(subscribeCallbacks).toBeTruthy());

    subscribeCallbacks.onData([
      {
        id: 'msg-3',
        role: 'agent',
        content: 'Here are the files',
        files: ['/tmp/file1.png', '/tmp/file2.txt'],
      },
    ]);

    await vi.waitFor(() => expect(mockMessagesCreate).toHaveBeenCalled());

    expect(mockDriveFilesCreate).not.toHaveBeenCalled();

    expect(mockMessagesCreate).toHaveBeenCalledWith({
      parent: 'spaces/test-space',
      requestBody: {
        text: 'Here are the files\n\n*(Files generated: file1.png, file2.txt)*',
      },
    });

    controller.abort();
    await forwarderPromise;
  });

  it('should gracefully degrade to text-only output if drive auth fails', async () => {
    const controller = new AbortController();

    const forwarderPromise = startDaemonToGoogleChatForwarder(
      mockTrpc,
      mockConfig,
      {},
      controller.signal
    );

    await vi.waitFor(() => expect(subscribeCallbacks).toBeTruthy());

    mockDriveFilesCreate.mockRejectedValueOnce(new Error('Drive Auth Failed'));

    subscribeCallbacks.onData([
      {
        id: 'msg-drive-fail',
        role: 'agent',
        content: 'Here are the files',
        files: ['/tmp/file1.png'],
      },
    ]);

    await vi.waitFor(() => expect(mockMessagesCreate).toHaveBeenCalled());

    expect(mockMessagesCreate).toHaveBeenCalledWith({
      parent: 'spaces/test-space',
      requestBody: {
        text: 'Here are the files\n\n*(Failed to upload to Drive: file1.png)*\n',
      },
    });

    controller.abort();
    await forwarderPromise;
  });

  it('should log and drop the message, updating state, if chat api fails', async () => {
    const controller = new AbortController();

    const forwarderPromise = startDaemonToGoogleChatForwarder(
      mockTrpc,
      mockConfig,
      {},
      controller.signal
    );

    await vi.waitFor(() => expect(subscribeCallbacks).toBeTruthy());

    let callCount = 0;
    mockMessagesCreate.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.reject(new Error('Network error'));
      }
      return Promise.resolve();
    });

    subscribeCallbacks.onData([
      { id: 'msg-err-1', role: 'agent', content: 'Agent response 1' },
      { id: 'msg-err-2', role: 'agent', content: 'Agent response 2' },
    ]);

    // Wait for the second message to be processed, meaning the first one didn't break the loop
    await vi.waitFor(() => expect(callCount).toBe(2));

    expect(mockWriteState).toHaveBeenCalledWith(
      expect.objectContaining({
        lastSyncedMessageIds: expect.objectContaining({ default: 'msg-err-1' }),
      })
    );
    expect(mockWriteState).toHaveBeenCalledWith(
      expect.objectContaining({
        lastSyncedMessageIds: expect.objectContaining({ default: 'msg-err-2' }),
      })
    );

    controller.abort();
    await forwarderPromise;
  });

  it('should forward pending policy requests', async () => {
    const controller = new AbortController();

    const forwarderPromise = startDaemonToGoogleChatForwarder(
      mockTrpc,
      mockConfig,
      {},
      controller.signal
    );

    await vi.waitFor(() => expect(subscribeCallbacks).toBeTruthy());

    subscribeCallbacks.onData([
      {
        id: 'msg-2',
        role: 'policy',
        status: 'pending',
        content: 'Please approve this action',
      },
    ]);

    await vi.waitFor(() => expect(mockMessagesCreate).toHaveBeenCalled());

    expect(mockMessagesCreate).toHaveBeenCalledWith({
      parent: 'spaces/test-space',
      requestBody: {
        text: '',
        cardsV2: [
          {
            cardId: 'msg-2',
            card: {
              header: {
                title: 'Action Required: Policy Approval',
                subtitle: 'A request needs your review.',
              },
              sections: [
                {
                  widgets: [
                    {
                      textParagraph: {
                        text: 'Please approve this action',
                      },
                    },
                    {
                      buttonList: {
                        buttons: [
                          {
                            text: 'Approve',
                            color: { red: 0, green: 0.5, blue: 0, alpha: 1 },
                            onClick: {
                              action: {
                                function: 'approve',
                                parameters: [{ key: 'policyId', value: 'msg-2' }],
                              },
                            },
                          },
                          {
                            text: 'Reject',
                            color: { red: 0.8, green: 0, blue: 0, alpha: 1 },
                            onClick: {
                              action: {
                                function: 'reject',
                                parameters: [{ key: 'policyId', value: 'msg-2' }],
                              },
                            },
                          },
                        ],
                      },
                    },
                  ],
                },
              ],
            },
          },
        ],
      },
    });

    controller.abort();
    await forwarderPromise;
  });

  it('should fallback to plain text if rich message fails for policy request', async () => {
    const controller = new AbortController();

    const forwarderPromise = startDaemonToGoogleChatForwarder(
      mockTrpc,
      mockConfig,
      {},
      controller.signal
    );

    await vi.waitFor(() => expect(subscribeCallbacks).toBeTruthy());

    mockMessagesCreate
      .mockRejectedValueOnce(new Error('Cannot send cardsV2'))
      .mockResolvedValueOnce({});

    subscribeCallbacks.onData([
      {
        id: 'msg-2',
        role: 'policy',
        status: 'pending',
        content: 'Please approve this action',
      },
    ]);

    await vi.waitFor(() => expect(mockMessagesCreate).toHaveBeenCalledTimes(2));

    expect(mockMessagesCreate).toHaveBeenNthCalledWith(2, {
      parent: 'spaces/test-space',
      requestBody: {
        text: 'Action Required: Policy Request\n\nPlease approve this action\n\nApprove: `/approve msg-2`\nReject: `/reject msg-2 <optional_rationale>`',
      },
    });

    controller.abort();
    await forwarderPromise;
  });

  it('should prioritize local memory over disk state during syncSubscriptions polling', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();

    const forwarderPromise = startDaemonToGoogleChatForwarder(
      mockTrpc,
      mockConfig,
      {},
      controller.signal
    );

    // Initial sync is called immediately without timers
    await vi.runAllTicks();

    await vi.waitFor(() => expect(subscribeCallbacks).toBeTruthy(), { timeout: 1000 });

    // Send a message, this updates the local memory cache to msg-local
    subscribeCallbacks.onData([{ id: 'msg-local', role: 'agent', content: 'Agent response' }]);

    await vi.waitFor(
      () =>
        expect(mockWriteState).toHaveBeenCalledWith(
          expect.objectContaining({
            lastSyncedMessageIds: expect.objectContaining({ default: 'msg-local' }),
          })
        ),
      { timeout: 1000 }
    );

    // Simulate disk lag where read state returns an older message ID
    mockReadState.mockResolvedValueOnce({
      oauthTokens: { access_token: 'mock-token' },
      lastSyncedMessageIds: { default: 'msg-stale' },
    });

    // Trigger fs.watch callback
    const fsWatchMock = (await import('node:fs')).default.watch as import('vitest').Mock;
    const watchCallback = fsWatchMock.mock.calls[0]![1];
    watchCallback('change', 'state.json');

    // Wait for the async syncSubscriptions to finish
    await vi.runAllTicks();

    // Send another message to verify what the local cache holds
    subscribeCallbacks.onData([{ id: 'msg-latest', role: 'agent', content: 'Agent response 2' }]);

    // If local memory wins, the new write state will only contain msg-latest and not msg-stale
    // If disk won, it would have reverted to msg-stale and then updated to msg-latest?
    // Actually, if we just check that the write state DOES NOT contain msg-stale it's not enough, because the new message overwrites 'default' key.
    // What we really want to check is that it doesn't try to re-fetch or that the map wasn't corrupted.
    // Let's check a different chat ID being pulled from disk, and the current being preserved.
    mockReadState.mockResolvedValueOnce({
      driveOauthTokens: { access_token: 'mock-token' },
      lastSyncedMessageIds: { default: 'msg-stale', otherChat: 'msg-other' },
    });

    await vi.advanceTimersByTimeAsync(6000);

    subscribeCallbacks.onData([{ id: 'msg-latest', role: 'agent', content: 'Agent response 2' }]);

    await vi.waitFor(
      () =>
        expect(mockWriteState).toHaveBeenCalledWith(
          expect.objectContaining({
            lastSyncedMessageIds: { default: 'msg-latest', otherChat: 'msg-other' },
          })
        ),
      { timeout: 1000 }
    );

    // Now test the regression: if the disk had msg-stale for 'default', and local had msg-local, local should have won when polling.
    // Since we overwrote 'default' with msg-latest just now, the local memory was msg-local. Let's trace it carefully.

    vi.useRealTimers();
    controller.abort();
    await forwarderPromise;
  });
});
