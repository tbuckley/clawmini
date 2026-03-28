import { google } from 'googleapis';
import { getAuthClient, getDriveAuthClient } from './auth.js';
import type { getTRPCClient } from './client.js';
import type { ChatMessage } from '../shared/chats.js';
import path from 'node:path';
import fs from 'node:fs';
import mime from 'mime-types';
import type { GoogleChatConfig } from './config.js';
import { readGoogleChatState, updateGoogleChatState } from './state.js';
import { getWorkspaceRoot } from '../shared/workspace.js';
import { shouldDisplayMessage, formatMessage } from '../shared/adapters/filtering.js';

export async function startDaemonToGoogleChatForwarder(
  trpc: ReturnType<typeof getTRPCClient>,
  config: GoogleChatConfig,
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

                  const isDisplayed = shouldDisplayMessage(message, config);

                  if (isDisplayed) {
                    const logMessage = message;

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
                            const driveClient = await getDriveAuthClient(config);
                            const driveApi = google.drive({ version: 'v3', auth: driveClient });
                            const workspaceRoot = getWorkspaceRoot(process.cwd());

                            let folderId: string | undefined;
                            try {
                              const queryRes = await driveApi.files.list({
                                q: "mimeType='application/vnd.google-apps.folder' and name='Clawmini Uploads' and trashed=false",
                                fields: 'files(id)',
                              });
                              if (queryRes.data.files && queryRes.data.files.length > 0) {
                                folderId = queryRes.data.files[0]!.id!;
                              } else {
                                const folderRes = await driveApi.files.create({
                                  requestBody: {
                                    name: 'Clawmini Uploads',
                                    mimeType: 'application/vnd.google-apps.folder',
                                  },
                                  fields: 'id',
                                });
                                if (folderRes.data.id) {
                                  folderId = folderRes.data.id;
                                }
                              }
                            } catch (err) {
                              console.error(
                                'Failed to create or find Clawmini Uploads folder',
                                err
                              );
                            }

                            const uploadPromises = files.map(async (fileRelPath) => {
                              const filePath = path.resolve(workspaceRoot, fileRelPath);
                              if (!fs.existsSync(filePath)) return null;

                              const fileName = path.basename(filePath);
                              const mimeType = mime.lookup(filePath) || 'application/octet-stream';

                              try {
                                const driveRes = await driveApi.files.create({
                                  requestBody: {
                                    name: fileName,
                                    ...(folderId ? { parents: [folderId] } : {}),
                                  },
                                  media: { mimeType, body: fs.createReadStream(filePath) },
                                  fields: 'id, webViewLink',
                                });

                                if (driveRes.data.id && driveRes.data.webViewLink) {
                                  const fileId = driveRes.data.id;
                                  try {
                                    await Promise.all(
                                      config.authorizedUsers.map((email) =>
                                        driveApi.permissions.create({
                                          fileId,
                                          requestBody: {
                                            type: 'user',
                                            role: 'reader',
                                            emailAddress: email,
                                          },
                                          sendNotificationEmail: false,
                                        })
                                      )
                                    );
                                  } catch (err) {
                                    console.error(
                                      `Failed to grant permissions for ${fileName}`,
                                      err
                                    );
                                  }
                                  return driveRes.data.webViewLink;
                                }
                                return null;
                              } catch (err) {
                                console.error(
                                  `Failed to upload file ${fileName} to Google Drive`,
                                  err
                                );
                                return `*(Failed to upload to Drive: ${fileName})*`;
                              }
                            });

                            const uploadResults = await Promise.all(uploadPromises);
                            for (const result of uploadResults) {
                              if (result) text += `${result}\n`;
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

// TODO: Consider adding a slight buffer and splitting on newlines `\n` closest to the 4000 limit when possible, ensuring that markdown blocks are less likely to be cleanly sheared in half.
function chunkString(str: string, size: number): string[] {
  const chunks: string[] = [];
  const chars = Array.from(str);
  for (let i = 0; i < chars.length; i += size) {
    chunks.push(chars.slice(i, i + size).join(''));
  }
  return chunks;
}
