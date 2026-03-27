import { describe, it, expect, vi, beforeEach } from 'vitest';
import { startDaemonToGoogleChatForwarder } from './forwarder.js';

const mockConfig = {
  projectId: 'test',
  subscriptionName: 'test',
  authorizedUsers: ['user@example.com'],
  chatId: 'default',
  directMessageName: 'spaces/test-space',
  driveUploadEnabled: true,
  driveOauthClientId: 'mock-client-id',
  driveOauthClientSecret: 'mock-client-secret',
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

const mockReadState = vi
  .fn()
  .mockResolvedValue({ driveOauthTokens: { access_token: 'mock-token' } });
const mockWriteState = vi.fn().mockResolvedValue(undefined);

vi.mock('./state.js', () => ({
  readGoogleChatState: () => mockReadState(),
  updateGoogleChatState: (state: any) => mockWriteState(state),
}));

vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(true),
    createReadStream: vi.fn().mockReturnValue('mock-stream'),
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
        role: 'log',
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
      controller.signal
    );

    await vi.waitFor(() => expect(subscribeCallbacks).toBeTruthy());

    subscribeCallbacks.onData([
      {
        id: 'msg-2',
        role: 'log',
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
      { ...mockConfig, driveOauthClientId: undefined, driveOauthClientSecret: undefined },
      controller.signal
    );

    await vi.waitFor(() => expect(subscribeCallbacks).toBeTruthy());

    subscribeCallbacks.onData([
      {
        id: 'msg-3',
        role: 'log',
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
});
