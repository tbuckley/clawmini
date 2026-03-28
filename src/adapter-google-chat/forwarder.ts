import { google } from 'googleapis';
import { getAuthClient } from './auth.js';
import type { getTRPCClient } from './client.js';
import type { ChatMessage } from '../shared/chats.js';
import path from 'node:path';
import type { GoogleChatConfig } from './config.js';
import { readGoogleChatState, updateGoogleChatState } from './state.js';
import {
  shouldDisplayMessage,
  formatMessage,
  type FilteringConfig,
} from '../shared/adapters/filtering.js';
import { buildPolicyCard, chunkString } from './utils.js';
import { uploadFilesToDrive } from './upload.js';

export async function startDaemonToGoogleChatForwarder(
  trpc: ReturnType<typeof getTRPCClient>,
  config: GoogleChatConfig,
  filteringConfig: FilteringConfig,
  signal?: AbortSignal
) {
  const state = await readGoogleChatState();
  let lastMessageId = state.lastSyncedMessageId;
  const chatId = config.chatId || 'default';

  if (!lastMessageId) {
    try {
      const messages = await trpc.getMessages.query({ chatId, limit: 1 });
      if (Array.isArray(messages) && messages.length > 0) {
        const lastMsg = messages[messages.length - 1];
        if (lastMsg) {
          lastMessageId = lastMsg.id;
          await updateGoogleChatState({ lastSyncedMessageId: lastMessageId });
        }
      }
    } catch (error) {
      if (signal?.aborted) return;
      console.error('Failed to fetch initial messages from daemon:', error);
    }
  }

  console.log(
    `Starting daemon-to-google-chat forwarder for chat ${chatId}, lastMessageId: ${lastMessageId}`
  );

  let retryDelay = 1000;
  const maxRetryDelay = 30000;

  return new Promise<void>((resolve) => {
    let subscription: { unsubscribe: () => void } | null = null;
    let messageQueue = Promise.resolve();

    const connect = () => {
      if (signal?.aborted) {
        resolve();
        return;
      }

      subscription = trpc.waitForMessages.subscribe(
        { chatId, lastMessageId },
        {
          onData: (messages) => {
            retryDelay = 1000;

            if (!Array.isArray(messages) || messages.length === 0) {
              return;
            }

            messageQueue = messageQueue
              .then(async () => {
                for (const rawMessage of messages) {
                  if (signal?.aborted) break;

                  const message = rawMessage as ChatMessage;

                  const isDisplayed = shouldDisplayMessage(message, filteringConfig);

                  if (isDisplayed) {
                    const logMessage = message;

                    const isPolicyRequest =
                      logMessage.role === 'policy' && logMessage.status === 'pending';

                    if (isPolicyRequest) {
                      let activeSpaceName = config.directMessageName;
                      if (!activeSpaceName) {
                        const currentState = await readGoogleChatState();
                        activeSpaceName = currentState.activeSpaceName;
                      }

                      if (!activeSpaceName) {
                        console.warn(
                          'No active Google Chat space to reply to. Ignoring policy request:',
                          logMessage.content
                        );
                        lastMessageId = logMessage.id;
                        await updateGoogleChatState({ lastSyncedMessageId: lastMessageId }).catch(
                          console.error
                        );
                        continue;
                      }

                      try {
                        const client = await getAuthClient();
                        const chatApi = google.chat({ version: 'v1', auth: client });

                        try {
                          await chatApi.spaces.messages.create({
                            parent: activeSpaceName as string,
                            requestBody: {
                              text: '',
                              cardsV2: buildPolicyCard(logMessage),
                            },
                          });
                        } catch (richError) {
                          console.warn(
                            'Failed to send rich policy request to Google Chat, falling back to plain text:',
                            richError
                          );
                          const policyId =
                            ('requestId' in logMessage && logMessage.requestId) || logMessage.id;
                          await chatApi.spaces.messages.create({
                            parent: activeSpaceName as string,
                            requestBody: {
                              text: `Action Required: Policy Request\n\n${logMessage.content || 'A pending policy request requires your attention.'}\n\nApprove: \`/approve ${policyId}\`\nReject: \`/reject ${policyId} <optional_rationale>\``,
                            },
                          });
                        }
                      } catch (error) {
                        console.error('Failed to send policy request to Google Chat:', error);
                      }

                      lastMessageId = logMessage.id;
                      await updateGoogleChatState({ lastSyncedMessageId: lastMessageId }).catch(
                        console.error
                      );
                      continue;
                    }

                    if ('level' in logMessage && logMessage.level === 'verbose') {
                      lastMessageId = logMessage.id;
                      await updateGoogleChatState({ lastSyncedMessageId: lastMessageId }).catch(
                        console.error
                      );
                      continue;
                    }

                    const hasContent = !!logMessage.content?.trim();
                    const files =
                      'files' in logMessage ? (logMessage.files as string[]) : undefined;
                    const hasFiles = Array.isArray(files) && files.length > 0;

                    if (!hasContent && !hasFiles) {
                      lastMessageId = logMessage.id;
                      await updateGoogleChatState({ lastSyncedMessageId: lastMessageId }).catch(
                        console.error
                      );
                      continue;
                    }

                    let activeSpaceName = config.directMessageName;
                    if (!activeSpaceName) {
                      const currentState = await readGoogleChatState();
                      activeSpaceName = currentState.activeSpaceName;
                    }

                    if (!activeSpaceName) {
                      console.warn(
                        'No active Google Chat space to reply to. Ignoring message:',
                        logMessage.content
                      );
                      lastMessageId = logMessage.id;
                      await updateGoogleChatState({ lastSyncedMessageId: lastMessageId }).catch(
                        console.error
                      );
                      continue;
                    }

                    try {
                      const client = await getAuthClient();
                      const chatApi = google.chat({ version: 'v1', auth: client });

                      let text = formatMessage(logMessage) || '';

                      if (hasFiles && files) {
                        const fileNames = files.map((f) => path.basename(f)).join(', ');

                        if (
                          config.driveUploadEnabled !== false &&
                          config.driveOauthClientId &&
                          config.driveOauthClientSecret
                        ) {
                          text += `\n\n`;
                          try {
                            const uploadResults = await uploadFilesToDrive(files, config);
                            for (const result of uploadResults) {
                              text += `${result}\n`;
                            }
                          } catch (driveAuthErr) {
                            console.error(
                              'Drive API/Auth Failed, degrading to local files output:',
                              driveAuthErr
                            );
                            // We drop the drive upload process here so we do not throw out of the message loop.
                            // This ensures transient or permanent auth failures don't block subsequent messages.
                            text += `*(Files generated: ${fileNames})*`;
                          }
                        } else {
                          text += `\n\n*(Files generated: ${fileNames})*`;
                        }
                      }

                      if (text.length > 4000) {
                        const chunks = chunkString(text, 4000);
                        for (let i = 0; i < chunks.length; i++) {
                          if (signal?.aborted) break;
                          await chatApi.spaces.messages.create({
                            parent: activeSpaceName as string,
                            requestBody: { text: chunks[i] as string },
                          });
                        }
                      } else {
                        await chatApi.spaces.messages.create({
                          parent: activeSpaceName as string,
                          requestBody: { text },
                        });
                      }
                    } catch (error) {
                      console.error('Failed to send message to Google Chat:', error);
                      // We drop the message here and do not throw so that a bad message (e.g. malformed or rejected by Google)
                      // does not cause an infinite crash loop where the forwarder keeps retrying the exact same bad message forever.
                    }
                  }

                  lastMessageId = message.id;
                  await updateGoogleChatState({ lastSyncedMessageId: lastMessageId }).catch(
                    console.error
                  );
                }
              })
              .catch((error) => {
                console.error('Message queue failed, forcing reconnect...', error);
                subscription?.unsubscribe();
                subscription = null;
                if (signal?.aborted) {
                  resolve();
                  return;
                }
                setTimeout(() => {
                  retryDelay = Math.min(retryDelay * 2, maxRetryDelay);
                  connect();
                }, retryDelay);
              });
          },
          onError: (error) => {
            console.error(
              `Error in daemon-to-google-chat forwarder subscription. Retrying in ${retryDelay}ms.`,
              error
            );
            subscription?.unsubscribe();
            subscription = null;

            if (signal?.aborted) {
              resolve();
              return;
            }

            setTimeout(() => {
              retryDelay = Math.min(retryDelay * 2, maxRetryDelay);
              connect();
            }, retryDelay);
          },
          onComplete: () => {
            subscription = null;
            if (!signal?.aborted) {
              setTimeout(() => connect(), retryDelay);
            } else {
              resolve();
            }
          },
        }
      );
    };

    connect();

    signal?.addEventListener('abort', () => {
      subscription?.unsubscribe();
      resolve();
    });
  });
}
