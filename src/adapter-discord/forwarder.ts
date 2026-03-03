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

  // 2. Start the observation loop
  while (!signal?.aborted) {
    try {
      const messages = await trpc.waitForMessages.query({
        chatId,
        lastMessageId,
        timeout: 30000,
      });

      if (!Array.isArray(messages) || messages.length === 0) {
        continue;
      }

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
            console.error(`Failed to send message to Discord user ${discordUserId}:`, error);
            // We don't advance lastMessageId if sending failed to ensure retry on next loop/restart
            // unless it's a permanent error. For now, we'll just break and retry.
            break;
          }
        }

        lastMessageId = message.id;
        await writeDiscordState({ lastSyncedMessageId: lastMessageId });
      }
    } catch (error) {
      if (signal?.aborted) break;
      // If the daemon is down, wait a bit before retrying
      console.error('Error in daemon-to-discord forwarder loop:', error);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

function chunkString(str: string, size: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < str.length; i += size) {
    chunks.push(str.slice(i, i + size));
  }
  return chunks;
}
