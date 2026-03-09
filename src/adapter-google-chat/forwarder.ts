import { google } from 'googleapis';
import type { getTRPCClient } from './client.js';
import { activeSpaceName, activeThreadName } from './active-thread.js';
import type { ChatMessage, CommandLogMessage } from '../shared/chats.js';
import path from 'node:path';

let authClient: Awaited<ReturnType<typeof google.auth.getClient>> | null = null;
async function getAuthClient() {
  if (!authClient) {
    authClient = await google.auth.getClient({
      scopes: ['https://www.googleapis.com/auth/chat.bot'],
    });
  }
  return authClient;
}

export async function startDaemonToGoogleChatForwarder(
  trpc: ReturnType<typeof getTRPCClient>,
  chatId: string = 'default',
  signal?: AbortSignal
) {
  let lastMessageId: string | undefined = undefined;

  try {
    const messages = await trpc.getMessages.query({ chatId, limit: 1 });
    if (Array.isArray(messages) && messages.length > 0) {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg) {
        lastMessageId = lastMsg.id;
      }
    }
  } catch (error) {
    if (signal?.aborted) return;
    console.error('Failed to fetch initial messages from daemon:', error);
  }

  console.log(`Starting daemon-to-google-chat forwarder for chat ${chatId}`);

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

                if (message.role === 'log') {
                  const logMessage = message as CommandLogMessage;

                  if (logMessage.level === 'verbose') {
                    lastMessageId = logMessage.id;
                    continue;
                  }

                  const hasContent = !!logMessage.content?.trim();
                  const hasFiles = Array.isArray(logMessage.files) && logMessage.files.length > 0;

                  if (!hasContent && !hasFiles) {
                    lastMessageId = logMessage.id;
                    continue;
                  }

                  if (!activeSpaceName) {
                    console.warn(
                      'No active Google Chat space to reply to. Ignoring message:',
                      logMessage.content
                    );
                    lastMessageId = logMessage.id;
                    continue;
                  }

                  try {
                    const client = await getAuthClient();
                    const chatApi = google.chat({ version: 'v1', auth: client });

                    // Format message (Google Chat doesn't support file upload directly via API easily unless we use Drive or specific attachments endpoint, so we just mention the files for now, or use basic text)
                    let text = logMessage.content || '';
                    if (hasFiles) {
                      const fileNames = logMessage.files?.map(f => path.basename(f)).join(', ');
                      text += `\n\n*(Files generated: ${fileNames})*`;
                    }

                    const requestBody: { text: string; thread?: { name: string } } = { text };
                    if (activeThreadName) {
                      requestBody.thread = { name: activeThreadName };
                    }

                    await chatApi.spaces.messages.create({
                      parent: activeSpaceName,
                      messageReplyOption: 'REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD',
                      requestBody,
                    });
                  } catch (error) {
                    console.error('Failed to send message to Google Chat:', error);
                    break;
                  }
                }

                lastMessageId = message.id;
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