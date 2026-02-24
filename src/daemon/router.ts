import { initTRPC } from '@trpc/server';
import { z } from 'zod';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { getSettingsPath } from '../shared/workspace.js';

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
        }),
      })
    )
    .mutation(async ({ input }) => {
      const message = input.data.message;
      const settingsPath = getSettingsPath();

      let settings;
      try {
        const settingsStr = await fs.readFile(settingsPath, 'utf8');
        settings = JSON.parse(settingsStr);
      } catch (err) {
        throw new Error(`Failed to read settings from ${settingsPath}: ${err}`, { cause: err });
      }

      if (!settings?.chats?.new) {
        throw new Error('No chats.new defined in settings.json');
      }

      const cmd = settings.chats.new;

      console.log(`Executing chat command: ${cmd}`);

      return new Promise((resolve, reject) => {
        const p = spawn(cmd, {
          shell: true,
          stdio: 'inherit',
          env: {
            ...process.env,
            // Pass the message securely via an environment variable to prevent shell injection.
            // TODO: Add Windows support (e.g., using "%CLAW_CLI_MESSAGE%").
            CLAW_CLI_MESSAGE: message,
          },
        });

        p.on('close', (code) => {
          if (code === 0) {
            resolve({ success: true });
          } else {
            reject(new Error(`Command exited with code ${code}`));
          }
        });

        p.on('error', (err) => {
          reject(err);
        });
      });
    }),
});

export type AppRouter = typeof AppRouter;
export const appRouter = AppRouter;
