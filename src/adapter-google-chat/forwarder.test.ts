import { describe, it, expect, vi, beforeEach } from 'vitest';
import { startDaemonToGoogleChatForwarder } from './forwarder.js';

const mockConfig = {
  projectId: 'test',
  subscriptionName: 'test',
  authorizedUsers: [],
  chatId: 'default',
  directMessageName: 'spaces/test-space',
};

const mockMessagesCreate = vi.fn().mockResolvedValue({});
const mockMediaUpload = vi.fn().mockResolvedValue({
  data: { attachmentDataRef: { resourceName: 'mock-ref' } },
});

vi.mock('googleapis', () => {
  return {
    google: {
      auth: {
        getClient: vi.fn().mockResolvedValue({}),
      },
      chat: vi.fn().mockReturnValue({
        spaces: {
          messages: {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            create: (...args: any[]) => mockMessagesCreate(...args),
          },
        },
        media: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          upload: (...args: any[]) => mockMediaUpload(...args),
        },
      }),
    },
  };
});

vi.mock('./state.js', () => ({
  readGoogleChatState: vi.fn().mockResolvedValue({}),
  writeGoogleChatState: vi.fn().mockResolvedValue(undefined),
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

  it('should format message with files if present', async () => {
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

    expect(mockMediaUpload).toHaveBeenCalledTimes(2);

    expect(mockMessagesCreate).toHaveBeenCalledWith({
      parent: 'spaces/test-space',
      requestBody: {
        text: 'Here are the files',
        attachment: [
          { attachmentDataRef: { resourceName: 'mock-ref' } },
          { attachmentDataRef: { resourceName: 'mock-ref' } },
        ],
      },
    });

    controller.abort();
    await forwarderPromise;
  });
});
