/* eslint-disable max-lines */
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
import { readGoogleChatState, updateGoogleChatState } from './state.js';
import { downloadAttachment as defaultDownloadAttachment } from './utils.js';
import { handleAdapterCommand, type CommandTrpcClient } from '../shared/adapters/commands.js';
import { formatMessage, type FilteringConfig } from '../shared/adapters/filtering.js';
import { google } from 'googleapis';
import { getAuthClient } from './auth.js';
import { handleRoutingCommand, type RoutingTrpcClient } from '../shared/adapters/routing.js';
import { prependBlockquote } from '../shared/adapters/blockquote.js';

import { handleAddedToSpace, handleRemovedFromSpace } from './subscriptions.js';
import { handleCardClicked } from './cards.js';

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

export type GoogleChatApi = ReturnType<typeof google.chat>;

export interface MessageSourceLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, listener: (...args: any[]) => void | Promise<void>): unknown;
}

export interface GoogleChatIngestionDeps {
  /** Inbound message source (defaults to a real Pub/Sub subscription). */
  subscription?: MessageSourceLike;
  /** Google Chat API client (defaults to `google.chat()` with ADC credentials). */
  chatApi?: GoogleChatApi;
  /** Root directory for resolving adapter state/config (defaults to `process.cwd()`). */
  startDir?: string;
  /** Attachment downloader (defaults to the real Chat media endpoint). */
  downloadAttachment?: (resourceName: string, maxSizeMB?: number) => Promise<Buffer>;
}

export function startGoogleChatIngestion(
  config: GoogleChatConfig,
  trpc: ReturnType<typeof getTRPCClient>,
  filteringConfig: FilteringConfig,
  deps: GoogleChatIngestionDeps = {}
) {
  const startDir = deps.startDir ?? process.cwd();
  const subscription: MessageSourceLike =
    deps.subscription ??
    (() => {
      const pubsub = new PubSub({ projectId: config.projectId });
      return pubsub.subscription(config.subscriptionName);
    })();

  const getChatApi = async (): Promise<GoogleChatApi> => {
    if (deps.chatApi) return deps.chatApi;
    const authClient = await getAuthClient();
    return google.chat({ version: 'v1', auth: authClient });
  };

  const downloadAttachment = deps.downloadAttachment ?? defaultDownloadAttachment;

  const seenMessageIds = new Map<string, number>();

  // Periodically clean up deduplication cache every 5 minutes
  setInterval(
    () => {
      const now = Date.now();
      for (const [id, ts] of seenMessageIds.entries()) {
        if (now - ts > 10 * 60 * 1000) {
          seenMessageIds.delete(id);
        }
      }
    },
    5 * 60 * 1000
  ).unref();

  subscription.on('message', async (message: Message) => {
    const downloadedFiles: string[] = [];
    try {
      const dataString = message.data.toString('utf8');
      const parsedData = JSON.parse(dataString);

      const isWorkspaceEvent =
        message.attributes &&
        message.attributes['ce-type'] === 'google.workspace.chat.message.v1.created';

      const eventType = isWorkspaceEvent ? 'MESSAGE' : parsedData.type;

      const eventMessage = isWorkspaceEvent ? parsedData.message || parsedData : parsedData.message;
      const email =
        (isWorkspaceEvent
          ? eventMessage?.sender?.email
          : parsedData.user?.email || eventMessage?.sender?.email) || '';
      const senderName = eventMessage?.sender?.name || parsedData.user?.name || '';

      const space = isWorkspaceEvent
        ? eventMessage?.space
        : parsedData.space || eventMessage?.space;
      const senderType = eventMessage?.sender?.type || '';
      const messageId = eventMessage?.name || '';
      const text = (eventMessage?.text || '').trim();

      if (senderType === 'BOT') return void message.ack();

      if (messageId) {
        if (seenMessageIds.has(messageId)) return void message.ack();
        seenMessageIds.set(messageId, Date.now());
      }

      // Only handle MESSAGE, CARD_CLICKED, ADDED_TO_SPACE, and REMOVED_FROM_SPACE events
      if (
        eventType !== 'MESSAGE' &&
        eventType !== 'CARD_CLICKED' &&
        eventType !== 'ADDED_TO_SPACE' &&
        eventType !== 'REMOVED_FROM_SPACE'
      ) {
        message.ack();
        return;
      }

      let isUserAuthorized = false;
      let authorizedByEmail = false;

      if (email && isAuthorized(email, config.authorizedUsers)) {
        isUserAuthorized = true;
        authorizedByEmail = true;
      } else if (senderName && isAuthorized(senderName, config.authorizedUsers)) {
        isUserAuthorized = true;
      }

      if (!isUserAuthorized) {
        console.log(`Unauthorized or missing identifier: email=${email}, name=${senderName}`);
        console.log('DEBUG missing identifier parsedData:', JSON.stringify(parsedData, null, 2));
        message.ack();
        return;
      }

      // Automatically authorize user IDs if associated an authorized email
      if (authorizedByEmail && senderName && !isAuthorized(senderName, config.authorizedUsers)) {
        console.log(
          `Automatically authorizing user ID ${senderName} based on authorized email ${email}`
        );
        config.authorizedUsers.push(senderName);
        updateGoogleChatConfig(config, startDir).catch((err) =>
          console.error('Failed to update config with new user ID:', err)
        );
      }

      const identifier = email || senderName;

      const spaceName = space?.name;

      if (!spaceName) {
        console.log('Ignoring message: Could not determine space name.');
        message.ack();
        return;
      }

      const currentState = await readGoogleChatState(startDir);

      const externalContextId = spaceName;
      const mappedChatId = currentState.channelChatMap?.[externalContextId]?.chatId;
      const isRoutingCommand = text.startsWith('/chat') || text.startsWith('/agent');

      if (eventType === 'ADDED_TO_SPACE') {
        await handleAddedToSpace(
          spaceName as string,
          externalContextId,
          space?.type,
          mappedChatId,
          mappedChatId,
          config,
          startDir
        );
        if (!text) {
          message.ack();
          return;
        }
      }

      if (eventType === 'REMOVED_FROM_SPACE') {
        await handleRemovedFromSpace(externalContextId, currentState, config, startDir);
        message.ack();
        return;
      }

      if (isRoutingCommand) {
        const stringChatMap = Object.fromEntries(
          Object.entries(currentState.channelChatMap || {}).map(([k, v]) => [k, v.chatId || ''])
        );
        const routingResult = await handleRoutingCommand(
          text,
          externalContextId,
          stringChatMap,
          'google-chat',
          trpc as unknown as RoutingTrpcClient
        );

        if (routingResult) {
          if (routingResult.type === 'mapped') {
            await updateGoogleChatState(
              (latestState) => ({
                channelChatMap: {
                  ...(latestState.channelChatMap || {}),
                  [externalContextId]: {
                    ...(latestState.channelChatMap?.[externalContextId] || {}),
                    chatId: routingResult.newChatId,
                  },
                },
              }),
              startDir
            );
          }

          try {
            const chatApi = await getChatApi();
            await chatApi.spaces.messages.create({
              parent: externalContextId,
              requestBody: { text: routingResult.text },
            });
          } catch (err) {
            console.error('Failed to send routing command reply:', err);
          }

          message.ack();
          return;
        }
      }

      let targetChatId = mappedChatId;

      if (!targetChatId && !isRoutingCommand) {
        const isFirstEverMessage =
          !currentState.channelChatMap ||
          Object.values(currentState.channelChatMap).every((entry) => !entry.chatId);

        if (isFirstEverMessage) {
          targetChatId = config.chatId || 'default';
          console.log(
            `First contact detected. Automatically mapping space ${externalContextId} to chat ${targetChatId}.`
          );
          await updateGoogleChatState(
            (latestState) => ({
              channelChatMap: {
                ...(latestState.channelChatMap || {}),
                [externalContextId]: {
                  ...(latestState.channelChatMap?.[externalContextId] || {}),
                  chatId: targetChatId as string,
                },
              },
            }),
            startDir
          );
        } else {
          const isDirectMessage =
            space?.type === 'DIRECT_MESSAGE' || space?.singleUserBotDm === true;
          const isMentioned =
            Array.isArray(eventMessage?.annotations) &&
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            eventMessage.annotations.some((a: any) => a.type === 'USER_MENTION');
          const isSlashCommand = text.startsWith('/');
          if (isDirectMessage || isMentioned || isSlashCommand) {
            console.log(`Unmapped space ${externalContextId}, sending first contact warning.`);
            try {
              const chatApi = await getChatApi();
              await chatApi.spaces.messages.create({
                parent: externalContextId,
                requestBody: {
                  text: 'This channel/space is not currently mapped to a daemon chat. Please use `/chat [chat-id]` or `/agent [agent-id]` to map it.',
                },
              });
            } catch (err) {
              console.error('Failed to send first contact warning:', err);
            }
          } else {
            console.log(
              `Unmapped space ${externalContextId}, silently ignoring background message.`
            );
          }
          message.ack();
          return;
        }
      }

      // Fallback typing safeguard
      if (!targetChatId) targetChatId = config.chatId || 'default';

      const isDirectMessage = space?.type === 'DIRECT_MESSAGE' || space?.singleUserBotDm === true;
      if (!isDirectMessage && eventType === 'MESSAGE') {
        const channelConfig = currentState.channelChatMap?.[externalContextId];
        const requiresMention =
          channelConfig?.requireMention !== undefined
            ? channelConfig.requireMention
            : config.requireMention;

        if (requiresMention && !isRoutingCommand) {
          const isMentioned =
            Array.isArray(eventMessage?.annotations) &&
            eventMessage.annotations.some(
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (a: any) => a.type === 'USER_MENTION' && a.userMention?.user?.type === 'BOT'
            );

          let isReplyToBot = false;
          if (eventMessage?.threadReply && eventMessage.thread?.name) {
            try {
              const chatApi = await getChatApi();
              const response = await chatApi.spaces.messages.list({
                parent: externalContextId,
                filter: `thread.name="${eventMessage.thread.name}"`,
              });
              isReplyToBot =
                response.data.messages?.some(
                  (m) =>
                    m.sender?.type === 'BOT' ||
                    m.annotations?.some(
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      (a: any) => a.type === 'USER_MENTION' && a.userMention?.user?.type === 'BOT'
                    )
                ) ?? false;
            } catch (err) {
              console.error('Failed to fetch thread messages for mention check:', err);
            }
          }

          // If requireMention is true and it's not a DM, ignore if not mentioned and not a thread reply to the bot.
          if (!isMentioned && !isReplyToBot) {
            message.ack();
            return;
          }
        }
      }

      if (eventType === 'CARD_CLICKED') {
        await handleCardClicked(
          parsedData,
          targetChatId as string,
          trpc as unknown as RoutingTrpcClient,
          getChatApi
        );
        message.ack();
        return;
      }

      const commandResult = await handleAdapterCommand(
        text,
        filteringConfig,
        trpc as unknown as CommandTrpcClient,
        targetChatId
      );

      if (commandResult) {
        let resultText = '';
        if (commandResult.type === 'text') {
          if (commandResult.newConfig) {
            filteringConfig.filters = commandResult.newConfig.filters;
            await updateGoogleChatState({ filters: filteringConfig.filters }, startDir);
          }
          resultText = commandResult.text;
        } else if (commandResult.type === 'debug') {
          resultText =
            commandResult.messages.length === 0
              ? 'No ignored background messages found.'
              : `**Debug Output (${commandResult.messages.length} ignored messages):**\n\n` +
                commandResult.messages.map((msg) => formatMessage(msg)).join('\n\n---\n\n');
        }

        const chatApi = await getChatApi();
        await chatApi.spaces.messages.create({
          parent: spaceName as string,
          requestBody: { text: resultText },
        });
        message.ack();
        return;
      }
      const attachments = eventMessage?.attachment || [];

      if (attachments.length > 0) {
        const tmpDir = path.join(getClawminiDir(startDir), 'tmp', 'google-chat');
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

      let forwardedText = text;
      const quotedMetadata = eventMessage?.quotedMessageMetadata;
      if (quotedMetadata) {
        let quotedText: string | undefined = quotedMetadata.quotedMessageSnapshot?.text;
        if (!quotedText && quotedMetadata.name) {
          try {
            const chatApi = await getChatApi();
            const quotedRes = await chatApi.spaces.messages.get({ name: quotedMetadata.name });
            quotedText = quotedRes.data?.text || undefined;
          } catch (err) {
            console.error('Failed to fetch quoted message:', err);
          }
        }
        if (quotedText) {
          forwardedText = prependBlockquote(quotedText, text);
        }
      }

      await trpc.sendMessage.mutate({
        type: 'send-message',
        client: 'cli',
        data: {
          message: forwardedText,
          chatId: targetChatId,
          files: downloadedFiles.length > 0 ? downloadedFiles : undefined,
          adapter: 'google-chat',
          noWait: true,
        },
      });

      console.log(`Forwarded message from ${identifier} to daemon.`);
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
