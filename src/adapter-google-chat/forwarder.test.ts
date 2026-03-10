import { describe, it, expect, vi, beforeEach } from 'vitest';
import { startDaemonToGoogleChatForwarder } from './forwarder.js';

vi.mock('./active-thread.js', () => ({
  activeSpaceName: 'spaces/test-space',
}));

const mockMessagesCreate = vi.fn().mockResolvedValue({});

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
      }),
    },
  };
});

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
      'default',
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
      'default',
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
