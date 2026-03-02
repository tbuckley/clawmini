import { initTRPC, TRPCError } from '@trpc/server';
import { z } from 'zod';
import fs from 'node:fs/promises';
import { getSettingsPath, readChatSettings, writeChatSettings } from '../shared/workspace.js';
import { CronJobSchema } from '../shared/config.js';
import { handleUserMessage } from './message.js';
import { getDefaultChatId } from '../shared/chats.js';
import { spawn } from 'node:child_process';
import { cronManager } from './cron.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { TokenPayload } from './auth.js';

export interface Context {
  req?: IncomingMessage | undefined;
  res?: ServerResponse | undefined;
  isApiServer?: boolean | undefined;
  tokenPayload?: TokenPayload | null | undefined;
}

const t = initTRPC.context<Context>().create();
export const router = t.router;
export const publicProcedure = t.procedure;

const apiAuthMiddleware = t.middleware(({ ctx, next }) => {
  if (ctx.isApiServer) {
    if (!ctx.tokenPayload) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Missing or invalid token' });
    }
  }
  return next({
    ctx: {
      ...ctx,
      tokenPayload: ctx.tokenPayload,
    },
  });
});

export const apiProcedure = t.procedure.use(apiAuthMiddleware);

async function resolveAndCheckChatId(ctx: Context, inputChatId?: string): Promise<string> {
  const chatId =
    inputChatId ??
    (ctx.isApiServer && ctx.tokenPayload ? ctx.tokenPayload.chatId : await getDefaultChatId());

  if (ctx.isApiServer && ctx.tokenPayload) {
    if (ctx.tokenPayload.chatId !== chatId) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Token not authorized for this chat' });
    }
  }

  return chatId;
}

const AppRouter = router({
  sendMessage: apiProcedure
    .input(
      z.object({
        type: z.literal('send-message'),
        client: z.literal('cli'),
        data: z.object({
          message: z.string(),
          chatId: z.string().optional(),
          sessionId: z.string().optional(),
          agentId: z.string().optional(),
          noWait: z.boolean().optional(),
        }),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const message = input.data.message;
      const chatId = await resolveAndCheckChatId(ctx, input.data.chatId);
      const noWait = input.data.noWait ?? false;
      const sessionId = input.data.sessionId;
      const agentId = input.data.agentId;
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

            if (stdin && p.stdin) {
              p.stdin.on('error', (err) => {
                if ((err as NodeJS.ErrnoException).code !== 'EPIPE') {
                  console.error('stdin error:', err);
                }
              });
              p.stdin.write(stdin);
              p.stdin.end();
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
        sessionId,
        agentId
      );

      return { success: true };
    }),
  ping: publicProcedure.query(() => {
    return { status: 'ok' };
  }),
  shutdown: publicProcedure.mutation(() => {
    // Schedule a shutdown shortly after the response is sent
    setTimeout(() => {
      console.log('Shutting down daemon...');
      process.exit(0);
    }, 100);
    return { success: true };
  }),
  logMessage: apiProcedure
    .input(
      z.object({
        chatId: z.string().optional(),
        message: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const chatId = await resolveAndCheckChatId(ctx, input.chatId);
      const timestamp = new Date().toISOString();
      const id = Date.now().toString() + Math.random().toString(36).substring(2, 7);

      const logMsg: import('../shared/chats.js').CommandLogMessage = {
        id,
        messageId: id,
        role: 'log',
        source: 'router',
        content: input.message,
        stderr: '',
        timestamp,
        command: 'clawmini-lite log',
        cwd: process.cwd(),
        exitCode: 0,
        stdout: input.message,
      };

      await import('../shared/chats.js').then((m) => m.appendMessage(chatId, logMsg));
      return { success: true };
    }),
  listCronJobs: apiProcedure
    .input(z.object({ chatId: z.string().optional() }))
    .query(async ({ input, ctx }) => {
      const chatId = await resolveAndCheckChatId(ctx, input.chatId);
      const settings = await readChatSettings(chatId);
      return settings?.jobs ?? [];
    }),
  addCronJob: apiProcedure
    .input(z.object({ chatId: z.string().optional(), job: CronJobSchema }))
    .mutation(async ({ input, ctx }) => {
      const chatId = await resolveAndCheckChatId(ctx, input.chatId);
      const settings = (await readChatSettings(chatId)) || {};
      const cronJobs = settings.jobs ?? [];
      const existingIndex = cronJobs.findIndex((j) => j.id === input.job.id);
      if (existingIndex >= 0) {
        cronJobs[existingIndex] = input.job;
      } else {
        cronJobs.push(input.job);
      }
      settings.jobs = cronJobs;
      await writeChatSettings(chatId, settings);
      cronManager.scheduleJob(chatId, input.job);
      return { success: true };
    }),
  deleteCronJob: apiProcedure
    .input(z.object({ chatId: z.string().optional(), id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const chatId = await resolveAndCheckChatId(ctx, input.chatId);
      const settings = await readChatSettings(chatId);
      if (!settings || !settings.jobs) {
        return { success: true, deleted: false };
      }
      const initialLength = settings.jobs.length;
      settings.jobs = settings.jobs.filter((j) => j.id !== input.id);
      if (settings.jobs.length !== initialLength) {
        await writeChatSettings(chatId, settings);
        cronManager.unscheduleJob(chatId, input.id);
        return { success: true, deleted: true };
      }
      return { success: true, deleted: false };
    }),
});

export type AppRouter = typeof AppRouter;
export const appRouter = AppRouter;
