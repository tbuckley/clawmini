import type { Client } from 'discord.js';
import type { getTRPCClient } from './client.js';
import { readDiscordState, writeDiscordState } from './state.js';

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
              for (const message of messages) {
                if (signal?.aborted) break;

                // Only forward logs (agent responses, system messages)
                if (message.role === 'log') {
                  if (!message.content.trim()) {
                    lastMessageId = message.id;
                    continue;
                  }

                  try {
                    const user = await client.users.fetch(discordUserId);
                    const dm = await user.createDM();

                    // Discord has a 2000 character limit for messages.
                    if (message.content.length > 2000) {
                      const chunks = chunkString(message.content, 2000);
                      for (const chunk of chunks) {
                        if (signal?.aborted) break;
                        await dm.send(chunk);
                      }
                    } else {
                      await dm.send(message.content);
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
