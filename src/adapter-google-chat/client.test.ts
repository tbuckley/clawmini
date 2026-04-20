import { describe, it, expect, vi, beforeEach } from 'vitest';
import { formatQuotedSender, getTRPCClient, startGoogleChatIngestion } from './client.js';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import * as workspace from '../shared/workspace.js';
import { createTRPCClient } from '@trpc/client';
import * as utils from './utils.js';

vi.mock('node:fs');
vi.mock('./state.js', () => ({
  readGoogleChatState: vi.fn().mockResolvedValue({
    channelChatMap: { 'spaces/123': { chatId: 'default' } },
    activeSpaceName: 'spaces/123',
  }),
  updateGoogleChatState: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('node:fs/promises', () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('../shared/workspace.js');
vi.mock('@trpc/client', () => ({
  createTRPCClient: vi.fn().mockReturnValue({
    ping: {
      query: vi.fn().mockResolvedValue({ status: 'ok' }),
    },
    getChats: {
      query: vi.fn().mockResolvedValue(['default', 'chat-1']),
    },
    getAgents: {
      query: vi.fn().mockResolvedValue(['agent-1']),
    },
    sendMessage: {
      mutate: vi.fn().mockResolvedValue({}),
    },
  }),
  httpLink: vi.fn(),
  splitLink: vi.fn(),
  httpSubscriptionLink: vi.fn(),
}));
vi.mock('../shared/fetch.js', () => ({
  createUnixSocketFetch: vi.fn(),
}));
vi.mock('./auth.js', () => ({
  getAuthClient: vi.fn().mockResolvedValue({}),
  getUserAuthClient: vi.fn().mockResolvedValue({
    getAccessToken: vi.fn().mockResolvedValue({ token: 'mock-token' }),
  }),
}));

const { mockSubscription } = vi.hoisted(() => ({
  mockSubscription: {
    on: vi.fn(),
  },
}));

vi.mock('googleapis', () => ({
  google: {
    chat: vi.fn().mockReturnValue({
      spaces: {
        messages: {
          create: vi.fn().mockResolvedValue({}),
          update: vi.fn().mockResolvedValue({}),
          list: vi.fn().mockResolvedValue({ data: { messages: [] } }),
        },
      },
    }),
  },
}));

vi.mock('@google-cloud/pubsub', () => {
  return {
    PubSub: class {
      subscription = vi.fn().mockReturnValue(mockSubscription);
    },
  };
});
vi.mock('./utils.js', () => ({
  downloadAttachment: vi.fn().mockResolvedValue(Buffer.from('mock-data')),
}));

describe('Google Chat Adapter Client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('formatQuotedSender', () => {
    const authorized = ['user@example.com', 'users/42'];

    it('returns undefined when sender is missing', () => {
      expect(formatQuotedSender(undefined, authorized)).toBeUndefined();
    });

    it('labels bots as "Assistant"', () => {
      expect(formatQuotedSender({ type: 'BOT' }, authorized)).toBe('Assistant');
    });

    it('returns undefined for authorized users by email', () => {
      expect(formatQuotedSender({ email: 'user@example.com', type: 'HUMAN' }, authorized)).toBeUndefined();
    });

    it('returns undefined for authorized users by user resource name', () => {
      expect(formatQuotedSender({ name: 'users/42', type: 'HUMAN' }, authorized)).toBeUndefined();
    });

    it('falls back to email for other people', () => {
      expect(
        formatQuotedSender(
          { email: 'other@example.com', name: 'users/9', type: 'HUMAN' },
          authorized
        )
      ).toBe('other@example.com');
    });

    it('falls back to user resource name when email is absent', () => {
      expect(formatQuotedSender({ name: 'users/9', type: 'HUMAN' }, authorized)).toBe('users/9');
    });
  });

  describe('getTRPCClient', () => {
    it('should throw error if daemon socket does not exist', () => {
      vi.mocked(workspace.getSocketPath).mockReturnValue('/tmp/test.sock');
      vi.mocked(fs.existsSync).mockReturnValue(false);

      expect(() => getTRPCClient()).toThrow(
        'Daemon not running. Socket not found at /tmp/test.sock'
      );
    });

    it('should create TRPC client if daemon socket exists', () => {
      vi.mocked(workspace.getSocketPath).mockReturnValue('/tmp/test.sock');
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const client = getTRPCClient();
      expect(client).toBeDefined();
      expect(createTRPCClient).toHaveBeenCalled();
    });
  });

  describe('startGoogleChatIngestion', () => {
    let trpcClient: ReturnType<typeof getTRPCClient>;

    beforeEach(() => {
      vi.mocked(workspace.getSocketPath).mockReturnValue('/tmp/test.sock');
      vi.mocked(workspace.getClawminiDir).mockReturnValue('/mock/dir');
      vi.mocked(fs.existsSync).mockReturnValue(true);
      trpcClient = getTRPCClient();

      startGoogleChatIngestion(
        {
          projectId: 'test-project',
          subscriptionName: 'test-sub',
          topicName: 'test-topic',
          authorizedUsers: ['user@example.com'],
          requireMention: false,
          maxAttachmentSizeMB: 25,
          directMessageName: 'spaces/123',
        },
        trpcClient,
        {}
      );
    });

    it('should ignore non-MESSAGE events', async () => {
      const onMessage = mockSubscription.on.mock.calls.find(
        (c: unknown[]) => c[0] === 'message'
      )![1] as (msg: unknown) => Promise<void>;
      const mockMsg = {
        data: Buffer.from(JSON.stringify({ type: 'UNKNOWN_EVENT' })),
        ack: vi.fn(),
        nack: vi.fn(),
      };
      await onMessage(mockMsg);

      expect(mockMsg.ack).toHaveBeenCalled();
      expect(trpcClient.sendMessage.mutate).not.toHaveBeenCalled();
    });

    it('should create subscription on ADDED_TO_SPACE for non-DM spaces', async () => {
      const onMessage = mockSubscription.on.mock.calls.find(
        (c: unknown[]) => c[0] === 'message'
      )![1] as (msg: unknown) => Promise<void>;

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi
          .fn()
          .mockResolvedValue({ name: 'subscriptions/123', expireTime: '2026-01-01T00:00:00Z' }),
      });
      globalThis.fetch = mockFetch;

      const mockMsg = {
        data: Buffer.from(
          JSON.stringify({
            type: 'ADDED_TO_SPACE',
            space: { name: 'spaces/new-space', type: 'SPACE' },
            user: { email: 'user@example.com' },
          })
        ),
        ack: vi.fn(),
        nack: vi.fn(),
      };

      const { updateGoogleChatState } = await import('./state.js');
      vi.mocked(updateGoogleChatState).mockClear();

      await onMessage(mockMsg);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://workspaceevents.googleapis.com/v1/subscriptions',
        expect.objectContaining({ method: 'POST' })
      );

      expect(updateGoogleChatState).toHaveBeenCalled();
      expect(mockMsg.ack).toHaveBeenCalled();
    });

    it('should delete subscription and update state on REMOVED_FROM_SPACE', async () => {
      const onMessage = mockSubscription.on.mock.calls.find(
        (c: unknown[]) => c[0] === 'message'
      )![1] as (msg: unknown) => Promise<void>;

      const mockFetch = vi.fn().mockResolvedValue({ ok: true });
      globalThis.fetch = mockFetch;

      // Ensure state has the subscription
      const { readGoogleChatState } = await import('./state.js');
      vi.mocked(readGoogleChatState).mockResolvedValueOnce({
        channelChatMap: {
          'spaces/removed': { chatId: 'chat1', subscriptionId: 'subscriptions/456' },
        },
      });

      const mockMsg = {
        data: Buffer.from(
          JSON.stringify({
            type: 'REMOVED_FROM_SPACE',
            space: { name: 'spaces/removed', type: 'SPACE' },
            user: { email: 'user@example.com' },
          })
        ),
        ack: vi.fn(),
        nack: vi.fn(),
      };

      const { updateGoogleChatState } = await import('./state.js');
      vi.mocked(updateGoogleChatState).mockClear();

      await onMessage(mockMsg);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://workspaceevents.googleapis.com/v1/subscriptions/456',
        expect.objectContaining({ method: 'DELETE' })
      );

      expect(updateGoogleChatState).toHaveBeenCalled();
      expect(mockMsg.ack).toHaveBeenCalled();
    });

    it('should assign object shape when mapping chat on routing command', async () => {
      const onMessage = mockSubscription.on.mock.calls.find(
        (c: unknown[]) => c[0] === 'message'
      )![1] as (msg: unknown) => Promise<void>;

      const { updateGoogleChatState } = await import('./state.js');
      vi.mocked(updateGoogleChatState).mockClear();

      const mockMsg = {
        data: Buffer.from(
          JSON.stringify({
            type: 'MESSAGE',
            space: { name: 'spaces/new-space', type: 'SPACE' },
            user: { email: 'user@example.com' },
            message: { text: '/chat chat-1' },
          })
        ),
        ack: vi.fn(),
        nack: vi.fn(),
      };

      await onMessage(mockMsg);

      expect(mockMsg.ack).toHaveBeenCalled();

      const updateCalls = vi.mocked(updateGoogleChatState).mock.calls;
      const lastCallArg = updateCalls[updateCalls.length - 1]![0];
      const result =
        typeof lastCallArg === 'function'
          ? lastCallArg({ channelChatMap: {} } as import('./state.js').GoogleChatState)
          : lastCallArg;

      expect(result.channelChatMap!['spaces/new-space']).toEqual({ chatId: 'chat-1' });
    });

    it('should ignore messages from unauthorized users', async () => {
      const onMessage = mockSubscription.on.mock.calls.find(
        (c: unknown[]) => c[0] === 'message'
      )![1] as (msg: unknown) => Promise<void>;
      const mockMsg = {
        data: Buffer.from(
          JSON.stringify({
            type: 'MESSAGE',
            space: { name: 'spaces/123', type: 'DIRECT_MESSAGE', singleUserBotDm: true },
            message: { sender: { email: 'bad@example.com' }, text: 'Hello' },
          })
        ),
        ack: vi.fn(),
        nack: vi.fn(),
      };
      await onMessage(mockMsg);

      expect(mockMsg.ack).toHaveBeenCalled();
      expect(trpcClient.sendMessage.mutate).not.toHaveBeenCalled();
    });

    it('should process authorized messages without attachments', async () => {
      const onMessage = mockSubscription.on.mock.calls.find(
        (c: unknown[]) => c[0] === 'message'
      )![1] as (msg: unknown) => Promise<void>;
      const mockMsg = {
        data: Buffer.from(
          JSON.stringify({
            type: 'MESSAGE',
            space: { name: 'spaces/123', type: 'DIRECT_MESSAGE', singleUserBotDm: true },
            message: {
              sender: { email: 'user@example.com' },
              text: 'Hello world',
              thread: { name: 'thread-123' },
            },
          })
        ),
        ack: vi.fn(),
        nack: vi.fn(),
      };
      await onMessage(mockMsg);

      expect(mockMsg.ack).toHaveBeenCalled();
      expect(trpcClient.sendMessage.mutate).toHaveBeenCalledWith({
        type: 'send-message',
        client: 'cli',
        data: {
          message: 'Hello world',
          chatId: 'default',
          adapter: 'google-chat',
          files: undefined,
          noWait: true,
        },
      });
    });

    it('should process authorized messages with attachments', async () => {
      const onMessage = mockSubscription.on.mock.calls.find(
        (c: unknown[]) => c[0] === 'message'
      )![1] as (msg: unknown) => Promise<void>;
      const mockMsg = {
        data: Buffer.from(
          JSON.stringify({
            type: 'MESSAGE',
            space: { name: 'spaces/123', type: 'DIRECT_MESSAGE', singleUserBotDm: true },
            message: {
              sender: { email: 'user@example.com' },
              text: 'Here is a file',
              thread: { name: 'thread-123' },
              attachment: [
                {
                  contentName: 'test.png',
                  attachmentDataRef: { resourceName: 'spaces/123/messages/123/attachments/123' },
                },
              ],
            },
          })
        ),
        ack: vi.fn(),
        nack: vi.fn(),
      };
      await onMessage(mockMsg);

      expect(utils.downloadAttachment).toHaveBeenCalledWith(
        'spaces/123/messages/123/attachments/123',
        25
      );
      expect(fsPromises.mkdir).toHaveBeenCalledWith('/mock/dir/tmp/google-chat', {
        recursive: true,
      });
      expect(fsPromises.writeFile).toHaveBeenCalled();

      expect(mockMsg.ack).toHaveBeenCalled();
      expect(trpcClient.sendMessage.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'send-message',
          data: expect.objectContaining({
            message: 'Here is a file',
            chatId: 'default',
            files: expect.any(Array),
            adapter: 'google-chat',
            noWait: true,
          }),
        })
      );
    });

    it('should nack the message on unexpected error', async () => {
      const onMessage = mockSubscription.on.mock.calls.find(
        (c: unknown[]) => c[0] === 'message'
      )![1] as (msg: unknown) => Promise<void>;
      const mockMsg = {
        data: Buffer.from(
          JSON.stringify({
            type: 'MESSAGE',
            space: { name: 'spaces/123', type: 'DIRECT_MESSAGE', singleUserBotDm: true },
          })
        ),
        ack: vi.fn(),
        nack: vi.fn(),
      };

      // Force an error
      vi.mocked(trpcClient.sendMessage.mutate).mockRejectedValueOnce(new Error('Network error'));

      const authorizedMockMsg = {
        ...mockMsg,
        data: Buffer.from(
          JSON.stringify({
            type: 'MESSAGE',
            space: { name: 'spaces/123', type: 'DIRECT_MESSAGE', singleUserBotDm: true },
            message: {
              sender: { email: 'user@example.com' },
              text: 'Hello with error',
              attachment: [
                {
                  contentName: 'test.png',
                  attachmentDataRef: { resourceName: 'spaces/123/messages/123/attachments/123' },
                },
              ],
            },
          })
        ),
      };

      await onMessage(authorizedMockMsg);

      expect(authorizedMockMsg.nack).toHaveBeenCalled();
      expect(authorizedMockMsg.ack).not.toHaveBeenCalled();
      expect(fsPromises.unlink).toHaveBeenCalled();
    });

    it('should process Workspace Events properly', async () => {
      const onMessage = mockSubscription.on.mock.calls.find(
        (c: unknown[]) => c[0] === 'message'
      )![1] as (msg: unknown) => Promise<void>;
      const mockMsg = {
        attributes: { 'ce-type': 'google.workspace.chat.message.v1.created' },
        data: Buffer.from(
          JSON.stringify({
            message: {
              name: 'spaces/123/messages/workspace-event',
              sender: { email: 'user@example.com', type: 'USER' },
              space: { name: 'spaces/123', type: 'DIRECT_MESSAGE', singleUserBotDm: true },
              text: 'Hello from Workspace Event',
            },
          })
        ),
        ack: vi.fn(),
        nack: vi.fn(),
      };
      await onMessage(mockMsg);

      expect(mockMsg.ack).toHaveBeenCalled();
      expect(trpcClient.sendMessage.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'send-message',
          data: expect.objectContaining({
            message: 'Hello from Workspace Event',
            chatId: 'default',
          }),
        })
      );
    });

    it('should drop duplicate messages within 60 seconds based on Message ID', async () => {
      const onMessage = mockSubscription.on.mock.calls.find(
        (c: unknown[]) => c[0] === 'message'
      )![1] as (msg: unknown) => Promise<void>;
      const mockMsg1 = {
        data: Buffer.from(
          JSON.stringify({
            type: 'MESSAGE',
            space: { name: 'spaces/123', type: 'DIRECT_MESSAGE', singleUserBotDm: true },
            message: {
              name: 'spaces/123/messages/duplicate-123',
              sender: { email: 'user@example.com', type: 'USER' },
              text: 'First message',
            },
          })
        ),
        ack: vi.fn(),
        nack: vi.fn(),
      };
      await onMessage(mockMsg1);

      const mockMsg2 = {
        data: Buffer.from(
          JSON.stringify({
            type: 'MESSAGE',
            space: { name: 'spaces/123', type: 'DIRECT_MESSAGE', singleUserBotDm: true },
            message: {
              name: 'spaces/123/messages/duplicate-123',
              sender: { email: 'user@example.com', type: 'USER' },
              text: 'Second message with same id',
            },
          })
        ),
        ack: vi.fn(),
        nack: vi.fn(),
      };
      await onMessage(mockMsg2);

      // The second message should be acked immediately but not sent to daemon
      expect(mockMsg2.ack).toHaveBeenCalled();

      // Mutate should have only been called once for the first message
      expect(trpcClient.sendMessage.mutate).toHaveBeenCalledTimes(1);
    });

    it('should drop messages where sender type is BOT', async () => {
      const onMessage = mockSubscription.on.mock.calls.find(
        (c: unknown[]) => c[0] === 'message'
      )![1] as (msg: unknown) => Promise<void>;
      const mockMsg = {
        data: Buffer.from(
          JSON.stringify({
            type: 'MESSAGE',
            space: { name: 'spaces/123', type: 'DIRECT_MESSAGE', singleUserBotDm: true },
            message: {
              name: 'spaces/123/messages/bot-msg',
              sender: { email: 'bot@example.com', type: 'BOT' },
              text: 'I am a bot',
            },
          })
        ),
        ack: vi.fn(),
        nack: vi.fn(),
      };
      await onMessage(mockMsg);

      expect(mockMsg.ack).toHaveBeenCalled();
      // mutate should not have been called because it's a BOT
      expect(trpcClient.sendMessage.mutate).not.toHaveBeenCalled();
    });

    it('should bypass requireMention if the message is a thread reply to the bot', async () => {
      const onMessage = mockSubscription.on.mock.calls.find(
        (c: unknown[]) => c[0] === 'message'
      )![1] as (msg: unknown) => Promise<void>;

      const { readGoogleChatState } = await import('./state.js');
      vi.mocked(readGoogleChatState).mockResolvedValue({
        channelChatMap: { 'spaces/123': { chatId: 'default', requireMention: true } },
      });

      // Override the list mock for this test
      const { google } = await import('googleapis');

      vi.mocked(google.chat({ version: 'v1' }).spaces.messages.list).mockResolvedValueOnce({
        data: { messages: [{ sender: { type: 'BOT' } }] },
      } as never);

      const mockMsg = {
        data: Buffer.from(
          JSON.stringify({
            type: 'MESSAGE',
            space: { name: 'spaces/123', type: 'SPACE' },
            user: { email: 'user@example.com' },
            message: {
              name: 'spaces/123/messages/reply-msg',
              text: 'This is a thread reply without mention',
              threadReply: true,
              thread: { name: 'spaces/123/threads/456' },
            },
          })
        ),
        ack: vi.fn(),
        nack: vi.fn(),
      };
      await onMessage(mockMsg);

      expect(mockMsg.ack).toHaveBeenCalled();
      expect(trpcClient.sendMessage.mutate).toHaveBeenCalled();
    });
  });
});
