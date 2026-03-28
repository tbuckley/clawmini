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
import { isAuthorized } from './config.js';
import { readGoogleChatState, updateGoogleChatState } from './state.js';
import { downloadAttachment } from './utils.js';
import { handleAdapterCommand, type CommandTrpcClient } from '../shared/adapters/commands.js';
import { formatMessage, type FilteringConfig } from '../shared/adapters/filtering.js';
import { google } from 'googleapis';
import { getAuthClient } from './auth.js';

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
  trpc: ReturnType<typeof getTRPCClient>,
  filteringConfig: FilteringConfig
) {
  const pubsub = new PubSub({ projectId: config.projectId });
  const subscription = pubsub.subscription(config.subscriptionName);

  subscription.on('message', async (message: Message) => {
    const downloadedFiles: string[] = [];
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

      const state = await readGoogleChatState();
      let activeSpaceName = config.directMessageName || state.activeSpaceName;

      if (!activeSpaceName) {
        activeSpaceName = spaceName;
        await updateGoogleChatState({ activeSpaceName });
      } else if (activeSpaceName !== spaceName) {
        console.log(`Ignoring message from inactive space: ${spaceName}`);
        message.ack();
        return;
      }

      const commandResult = await handleAdapterCommand(
        text,
        filteringConfig,
        trpc as unknown as CommandTrpcClient,
        config.chatId || 'default'
      );

      if (commandResult) {
        let resultText = '';
        if (commandResult.type === 'text') {
          resultText = commandResult.text;
        } else if (commandResult.type === 'debug') {
          resultText =
            commandResult.messages.length === 0
              ? 'No ignored background messages found.'
              : `**Debug Output (${commandResult.messages.length} ignored messages):**\n\n` +
                commandResult.messages.map((msg) => formatMessage(msg)).join('\n\n---\n\n');
        }

        const authClient = await getAuthClient();
        const chatApi = google.chat({ version: 'v1', auth: authClient });
        await chatApi.spaces.messages.create({
          parent: activeSpaceName as string,
          requestBody: { text: resultText },
        });
        message.ack();
        return;
      }

      const attachments = event.message?.attachment || [];

      if (attachments.length > 0) {
        const tmpDir = path.join(getClawminiDir(process.cwd()), 'tmp', 'google-chat');
        await fsPromises.mkdir(tmpDir, { recursive: true });

        for (const att of attachments) {
          const resourceName = att.attachmentDataRef?.resourceName;
          if (resourceName) {
            try {
              const buffer = await downloadAttachment(resourceName, config.maxAttachmentSizeMB);
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
      for (const file of downloadedFiles) {
        try {
          await fsPromises.unlink(file);
        } catch (unlinkErr) {
          console.error(`Failed to delete downloaded file ${file} after error:`, unlinkErr);
        }
      }
      // Add a brief artificial delay before nacking to avoid tight retry loops
      await new Promise((resolve) => setTimeout(resolve, 2000));
      // Nack the message so it can be retried if it's a transient failure
      message.nack();
    }
  });

  subscription.on('error', (error) => {
    console.error('Pub/Sub subscription error:', error);
  });

  return subscription;
}
