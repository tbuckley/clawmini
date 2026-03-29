import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getTRPCClient, startGoogleChatIngestion } from './client.js';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import * as workspace from '../shared/workspace.js';
import { createTRPCClient } from '@trpc/client';
import * as utils from './utils.js';

vi.mock('node:fs');
vi.mock('./state.js', () => ({
  readGoogleChatState: vi.fn().mockResolvedValue({
    channelChatMap: { 'spaces/123': 'default' },
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
const { mockSubscription } = vi.hoisted(() => ({
  mockSubscription: {
    on: vi.fn(),
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
          authorizedUsers: ['user@example.com'],
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
        data: Buffer.from(JSON.stringify({ type: 'ADDED_TO_SPACE' })),
        ack: vi.fn(),
        nack: vi.fn(),
      };
      await onMessage(mockMsg);

      expect(mockMsg.ack).toHaveBeenCalled();
      expect(trpcClient.sendMessage.mutate).not.toHaveBeenCalled();
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
  });
});
