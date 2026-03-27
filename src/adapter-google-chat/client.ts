import { PubSub, Message } from '@google-cloud/pubsub';
import { createTRPCClient, httpLink, splitLink, httpSubscriptionLink } from '@trpc/client';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

import type { UserRouter as AppRouter } from '../daemon/api/index.js';
import { getSocketPath, getClawminiDir } from '../shared/workspace.js';
import { createUnixSocketFetch } from '../shared/fetch.js';
import { createUnixSocketEventSource } from '../shared/event-source.js';
import type { GoogleChatConfig } from './config.js';
import { isAuthorized, updateGoogleChatConfig } from './config.js';
import { downloadAttachment } from './utils.js';

export function getTRPCClient(options: { socketPath?: string } = {}) {
  const socketPath = options.socketPath ?? getSocketPath();

  if (!fs.existsSync(socketPath)) {
    throw new Error(`Daemon not running. Socket not found at ${socketPath}`);
  }

  const customFetch = createUnixSocketFetch(socketPath);
  const CustomEventSource = createUnixSocketEventSource(socketPath);

  return createTRPCClient<AppRouter>({
    links: [
      splitLink({
        condition(op) {
          return op.type === 'subscription';
        },
        true: httpSubscriptionLink({
          url: 'http://localhost',
          EventSource: CustomEventSource,
        }),
        false: httpLink({
          url: 'http://localhost',
          fetch: customFetch,
        }),
      }),
    ],
  });
}

export function startGoogleChatIngestion(
  config: GoogleChatConfig,
  trpc: ReturnType<typeof getTRPCClient>
) {
  const pubsub = new PubSub({ projectId: config.projectId });
  const subscription = pubsub.subscription(config.subscriptionName);

  subscription.on('message', async (message: Message) => {
    try {
      const dataString = message.data.toString('utf8');
      const event = JSON.parse(dataString);

      // Only handle MESSAGE events
      if (event.type !== 'MESSAGE') {
        message.ack();
        return;
      }

      const email = event.message?.sender?.email;
      if (!email || !isAuthorized(email, config.authorizedUsers)) {
        console.log(`Unauthorized or missing email: ${email}`);
        message.ack();
        return;
      }

      const text = event.message?.text || '';
      const space = event.space || event.message?.space;
      const spaceName = space?.name;

      if (space?.type !== 'DIRECT_MESSAGE' && space?.singleUserBotDm !== true) {
        console.log(`Ignoring message from unsupported space type: ${space?.type}`);
        message.ack();
        return;
      }

      if (!spaceName) {
        console.log('Ignoring message: Could not determine space name.');
        message.ack();
        return;
      }

      if (config.directMessageName !== spaceName) {
        config.directMessageName = spaceName;
        await updateGoogleChatConfig(config);
      }

      const downloadedFiles: string[] = [];
      const attachments = event.message?.attachment || [];

      if (attachments.length > 0) {
        const tmpDir = path.join(getClawminiDir(process.cwd()), 'tmp', 'google-chat');
        await fsPromises.mkdir(tmpDir, { recursive: true });

        for (const att of attachments) {
          const downloadUri = att.attachmentDataRef?.downloadUri;
          if (downloadUri) {
            try {
              const buffer = await downloadAttachment(downloadUri, config.maxAttachmentSizeMB);
              const uniqueName = `${crypto.randomUUID()}-${att.contentName || 'attachment'}`;
              const filePath = path.join(tmpDir, uniqueName);
              await fsPromises.writeFile(filePath, buffer);
              downloadedFiles.push(filePath);
            } catch (err) {
              console.error(`Error downloading attachment:`, err);
            }
          }
        }
      }

      await trpc.sendMessage.mutate({
        type: 'send-message',
        client: 'cli',
        data: {
          message: text,
          chatId: config.chatId || 'default',
          files: downloadedFiles.length > 0 ? downloadedFiles : undefined,
          adapter: 'google-chat',
          noWait: true,
        },
      });

      console.log(`Forwarded message from ${email} to daemon.`);
      message.ack();
    } catch (error) {
      console.error('Error processing Pub/Sub message:', error);
      // Nack the message so it can be retried if it's a transient failure
      message.nack();
    }
  });

  subscription.on('error', (error) => {
    console.error('Pub/Sub subscription error:', error);
  });

  return subscription;
}
