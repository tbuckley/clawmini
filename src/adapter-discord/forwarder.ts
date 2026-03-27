import type { Client, MessageCreateOptions } from 'discord.js';
import path from 'node:path';
import type { getTRPCClient } from './client.js';
import { readDiscordState, writeDiscordState } from './state.js';
import type { ChatMessage, LegacyLogMessage } from '../shared/chats.js';
import { getWorkspaceRoot } from '../shared/workspace.js';

export async function startDaemonToDiscordForwarder(
  client: Client,
  trpc: ReturnType<typeof getTRPCClient>,
  discordUserId: string,
  chatId: string = 'default',
  signal?: AbortSignal
) {
  const state = await readDiscordState();
  let lastMessageId = state.lastSyncedMessageId;

  // 1. If we don't have a lastMessageId, get the most recent one from the daemon
  // to avoid sending the entire chat history on first run.
  if (!lastMessageId) {
    try {
      const messages = await trpc.getMessages.query({ chatId, limit: 1 });
      if (Array.isArray(messages) && messages.length > 0) {
        const lastMsg = messages[messages.length - 1];
        if (lastMsg) {
          lastMessageId = lastMsg.id;
          await writeDiscordState({ lastSyncedMessageId: lastMessageId });
        }
      }
    } catch (error) {
      if (signal?.aborted) return;
      console.error('Failed to fetch initial messages from daemon:', error);
    }
  }

  console.log(
    `Starting daemon-to-discord forwarder for chat ${chatId}, lastMessageId: ${lastMessageId}`
  );

  let retryDelay = 1000;
  const maxRetryDelay = 30000;

  // 2. Start the observation loop using tRPC subscription
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
            retryDelay = 1000; // Reset retry delay on successful data

            if (!Array.isArray(messages) || messages.length === 0) {
              return;
            }

            // Queue processing to ensure sequential execution
            messageQueue = messageQueue.then(async () => {
              for (const rawMessage of messages) {
                if (signal?.aborted) break;

                const message = rawMessage as ChatMessage;

                // Only forward messages that are explicitly marked for agent display,
                // or are backwards-compatible agent replies / legacy logs.
                // Ignore any messages associated with subagents.
                const isAgentDisplay =
                  message.displayRole === 'agent' ||
                  message.role === 'agent' ||
                  message.role === 'legacy_log';

                if (isAgentDisplay && !message.subagentId) {
                  const logMessage = message;

                  if ('level' in logMessage && logMessage.level === 'verbose') {
                    lastMessageId = logMessage.id;
                    await writeDiscordState({ lastSyncedMessageId: lastMessageId }).catch(
                      console.error
                    );
                    continue;
                  }

                  const hasContent = !!logMessage.content?.trim();
                  const files = 'files' in logMessage ? (logMessage.files as string[]) : undefined;
                  const hasFiles = Array.isArray(files) && files.length > 0;

                  // The daemon stores logMessage.files as paths relative to the WORKSPACE directory
                  // (the directory containing .clawmini). We must resolve these against the current
                  // workspace root so discord.js can successfully locate and read the files.
                  let absoluteFiles: string[] = [];
                  if (hasFiles && files) {
                    const workspaceRoot = getWorkspaceRoot(process.cwd());
                    absoluteFiles = files.map((f) => path.resolve(workspaceRoot, f));
                  }

                  if (!hasContent && !hasFiles) {
                    lastMessageId = logMessage.id;
                    await writeDiscordState({ lastSyncedMessageId: lastMessageId }).catch(
                      console.error
                    );
                    continue;
                  }

                  try {
                    const user = await client.users.fetch(discordUserId);
                    const dm = await user.createDM();

                    // Discord has a 2000 character limit for messages.
                    if (hasContent && logMessage.content.length > 2000) {
                      const chunks = chunkString(logMessage.content, 2000);
                      for (let i = 0; i < chunks.length; i++) {
                        if (signal?.aborted) break;
                        const chunkOptions: MessageCreateOptions = { content: chunks[i] as string };
                        if (i === chunks.length - 1 && hasFiles) {
                          chunkOptions.files = absoluteFiles;
                        }
                        await dm.send(chunkOptions);
                      }
                    } else {
                      const options: MessageCreateOptions = {};
                      if (hasContent) {
                        options.content = logMessage.content;
                      }
                      if (hasFiles) {
                        options.files = absoluteFiles;
                      }
                      await dm.send(options);
                    }
                  } catch (error) {
                    console.error(
                      `Failed to send message to Discord user ${discordUserId}:`,
                      error
                    );
                    // We don't advance lastMessageId if sending failed
                    break;
                  }
                }

                lastMessageId = message.id;
                await writeDiscordState({ lastSyncedMessageId: lastMessageId }).catch(
                  console.error
                );
              }
            });
          },
          onError: (error) => {
            console.error(
              `Error in daemon-to-discord forwarder subscription. Retrying in ${retryDelay}ms.`,
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

    let typingSubscription: { unsubscribe: () => void } | null = null;
    let typingRetryDelay = 1000;

    const connectTyping = () => {
      if (signal?.aborted) {
        return;
      }

      typingSubscription = trpc.waitForTyping.subscribe(
        { chatId },
        {
          onData: async (event) => {
            typingRetryDelay = 1000; // Reset retry delay on successful data
            if (!event) return;

            try {
              const user = await client.users.fetch(discordUserId);
              const dm = await user.createDM();
              await dm.sendTyping();
            } catch (error) {
              console.error(
                `Failed to send typing indicator to Discord user ${discordUserId}:`,
                error
              );
            }
          },
          onError: (error) => {
            console.error(
              `Error in daemon-to-discord typing forwarder subscription. Retrying in ${typingRetryDelay}ms.`,
              error
            );
            typingSubscription?.unsubscribe();
            typingSubscription = null;

            if (signal?.aborted) {
              return;
            }

            setTimeout(() => {
              typingRetryDelay = Math.min(typingRetryDelay * 2, maxRetryDelay);
              connectTyping();
            }, typingRetryDelay);
          },
          onComplete: () => {
            typingSubscription = null;
            if (!signal?.aborted) {
              setTimeout(() => connectTyping(), typingRetryDelay);
            }
          },
        }
      );
    };

    connect();
    connectTyping();

    signal?.addEventListener('abort', () => {
      subscription?.unsubscribe();
      typingSubscription?.unsubscribe();
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
