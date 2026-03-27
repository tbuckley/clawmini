import { google } from 'googleapis';
import { getAuthClient, getDriveAuthClient } from './auth.js';
import type { getTRPCClient } from './client.js';
import type { ChatMessage, CommandLogMessage } from '../shared/chats.js';
import path from 'node:path';
import fs from 'node:fs';
import mime from 'mime-types';
import type { GoogleChatConfig } from './config.js';
import { readGoogleChatState, writeGoogleChatState } from './state.js';
import { getWorkspaceRoot } from '../shared/workspace.js';

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
          await writeGoogleChatState({ lastSyncedMessageId: lastMessageId });
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

            messageQueue = messageQueue.then(async () => {
              for (const rawMessage of messages) {
                if (signal?.aborted) break;

                const message = rawMessage as ChatMessage;

                if (message.role === 'log' && !message.subagentId) {
                  const logMessage = message as CommandLogMessage;

                  if (logMessage.level === 'verbose') {
                    lastMessageId = logMessage.id;
                    await writeGoogleChatState({ lastSyncedMessageId: lastMessageId }).catch(
                      console.error
                    );
                    continue;
                  }

                  const hasContent = !!logMessage.content?.trim();
                  const hasFiles = Array.isArray(logMessage.files) && logMessage.files.length > 0;

                  if (!hasContent && !hasFiles) {
                    lastMessageId = logMessage.id;
                    await writeGoogleChatState({ lastSyncedMessageId: lastMessageId }).catch(
                      console.error
                    );
                    continue;
                  }

                  if (!config.directMessageName) {
                    console.warn(
                      'No active Google Chat space to reply to. Ignoring message:',
                      logMessage.content
                    );
                    lastMessageId = logMessage.id;
                    await writeGoogleChatState({ lastSyncedMessageId: lastMessageId }).catch(
                      console.error
                    );
                    continue;
                  }

                  try {
                    const client = await getAuthClient();
                    const chatApi = google.chat({ version: 'v1', auth: client });

                    let text = logMessage.content || '';

                    if (hasFiles) {
                      const fileNames = logMessage.files?.map((f) => path.basename(f)).join(', ');

                      if (config.driveUploadEnabled !== false) {
                        text += `\n\n`;
                        const driveClient = await getDriveAuthClient(config);
                        const driveApi = google.drive({ version: 'v3', auth: driveClient });
                        const workspaceRoot = getWorkspaceRoot(process.cwd());

                        for (const fileRelPath of logMessage.files!) {
                          const filePath = path.resolve(workspaceRoot, fileRelPath);
                          if (!fs.existsSync(filePath)) {
                            continue;
                          }

                          const fileName = path.basename(filePath);
                          const mimeType = mime.lookup(filePath) || 'application/octet-stream';

                          try {
                            const driveRes = await driveApi.files.create({
                              requestBody: { name: fileName },
                              media: { mimeType, body: fs.createReadStream(filePath) },
                              fields: 'id, webViewLink',
                            });

                            if (driveRes.data.id && driveRes.data.webViewLink) {
                              for (const email of config.authorizedUsers) {
                                await driveApi.permissions.create({
                                  fileId: driveRes.data.id,
                                  requestBody: {
                                    type: 'user',
                                    role: 'reader',
                                    emailAddress: email,
                                  },
                                  sendNotificationEmail: false,
                                });
                              }
                              text += `${driveRes.data.webViewLink}\n`;
                            }
                          } catch (err) {
                            console.error(`Failed to upload file ${fileName} to Google Drive`, err);
                            text += `(Failed to upload to Drive: ${fileName})\n`;
                          }
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
                          parent: config.directMessageName,
                          requestBody: { text: chunks[i] as string },
                        });
                      }
                    } else {
                      await chatApi.spaces.messages.create({
                        parent: config.directMessageName,
                        requestBody: { text },
                      });
                    }
                  } catch (error) {
                    console.error('Failed to send message to Google Chat:', error);
                    break; // break early to avoid updating state if sending failed
                  }
                }

                lastMessageId = message.id;
                await writeGoogleChatState({ lastSyncedMessageId: lastMessageId }).catch(
                  console.error
                );
              }
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

function chunkString(str: string, size: number): string[] {
  const chunks: string[] = [];
  const chars = Array.from(str);
  for (let i = 0; i < chars.length; i += size) {
    chunks.push(chars.slice(i, i + size).join(''));
  }
  return chunks;
}
