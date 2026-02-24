import { initTRPC } from '@trpc/server';
import { z } from 'zod';
import fs from 'node:fs/promises';
import { getSettingsPath } from '../shared/workspace.js';
import { handleUserMessage } from './queue.js';
import { getDefaultChatId } from '../shared/chats.js';

const t = initTRPC.create();
export const router = t.router;
export const publicProcedure = t.procedure;

const AppRouter = router({
  sendMessage: publicProcedure
    .input(
      z.object({
        type: z.literal('send-message'),
        client: z.literal('cli'),
        data: z.object({
          message: z.string(),
          chatId: z.string().optional(),
          noWait: z.boolean().optional(),
        }),
      })
    )
    .mutation(async ({ input }) => {
      const message = input.data.message;
      const chatId = input.data.chatId ?? await getDefaultChatId();
      const noWait = input.data.noWait ?? false;
      const settingsPath = getSettingsPath();

      let settings;
      try {
        const settingsStr = await fs.readFile(settingsPath, 'utf8');
        settings = JSON.parse(settingsStr);
      } catch (err) {
        throw new Error(`Failed to read settings from ${settingsPath}: ${err}`, { cause: err });
      }

      await handleUserMessage(chatId, message, settings, undefined, noWait);

      return { success: true };
    }),
});

export type AppRouter = typeof AppRouter;
export const appRouter = AppRouter;
