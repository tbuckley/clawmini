import { initTRPC } from '@trpc/server';
import { z } from 'zod';
import fs from 'node:fs/promises';
import { getSettingsPath } from '../shared/workspace.js';
import { handleUserMessage } from './message.js';
import { getDefaultChatId } from '../shared/chats.js';
import { spawn } from 'node:child_process';

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
          sessionId: z.string().optional(),
          noWait: z.boolean().optional(),
        }),
      })
    )
    .mutation(async ({ input }) => {
      const message = input.data.message;
      const chatId = input.data.chatId ?? (await getDefaultChatId());
      const noWait = input.data.noWait ?? false;
      const sessionId = input.data.sessionId;
      const settingsPath = getSettingsPath();

      let settings;
      try {
        const settingsStr = await fs.readFile(settingsPath, 'utf8');
        settings = JSON.parse(settingsStr);
      } catch (err) {
        throw new Error(`Failed to read settings from ${settingsPath}: ${err}`, { cause: err });
      }

      await handleUserMessage(
        chatId,
        message,
        settings,
        undefined,
        noWait,
        async ({ command, cwd, env, stdin }) => {
          return new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve) => {
            const p = spawn(command, {
              shell: true,
              cwd,
              env,
            });

            if (stdin) {
              p.stdin?.write(stdin);
              p.stdin?.end();
            }

            let stdout = '';
            let stderr = '';

            if (p.stdout) {
              p.stdout.on('data', (data) => {
                stdout += data.toString();
                // Only write to terminal if it's the main command (no stdin passed)
                if (!stdin) {
                  process.stdout.write(data);
                }
              });
            }

            if (p.stderr) {
              p.stderr.on('data', (data) => {
                stderr += data.toString();
                // Only write to terminal if it's the main command (no stdin passed)
                if (!stdin) {
                  process.stderr.write(data);
                }
              });
            }

            p.on('close', (code) => {
              resolve({ stdout, stderr, exitCode: code ?? 1 });
            });

            p.on('error', (err) => {
              resolve({ stdout: '', stderr: err.toString(), exitCode: 1 });
            });
          });
        },
        sessionId
      );

      return { success: true };
    }),
});

export type AppRouter = typeof AppRouter;
export const appRouter = AppRouter;
