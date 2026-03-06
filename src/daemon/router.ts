/* eslint-disable max-lines */
import { initTRPC, TRPCError } from '@trpc/server';
import { z } from 'zod';
import fs from 'node:fs/promises';
import path from 'node:path';
import { daemonEvents, DAEMON_EVENT_MESSAGE_APPENDED } from './events.js';
import {
  getSettingsPath,
  readChatSettings,
  writeChatSettings,
  getAgent,
  getWorkspaceRoot,
} from '../shared/workspace.js';
import { CronJobSchema } from '../shared/config.js';
import { handleUserMessage } from './message.js';
import { getDefaultChatId, getMessages } from './chats.js';
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

export async function getUniquePath(p: string): Promise<string> {
  let currentPath = p;
  let counter = 1;
  while (true) {
    try {
      await fs.stat(currentPath);
      const ext = path.extname(p);
      const base = path.basename(p, ext);
      currentPath = path.join(path.dirname(p), `${base}-${counter}${ext}`);
      counter++;
    } catch {
      return currentPath;
    }
  }
}

async function resolveAgentDir(
  agentId: string | undefined | null,
  workspaceRoot: string
): Promise<string> {
  if (agentId && agentId !== 'default') {
    const agent = await getAgent(agentId, workspaceRoot);
    if (agent && agent.directory) {
      return path.resolve(workspaceRoot, agent.directory);
    }
    return path.resolve(workspaceRoot, agentId);
  }
  return workspaceRoot;
}

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

async function getAgentFilesDir(
  agentId: string | undefined,
  chatId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  settings: any,
  workspaceRoot: string
): Promise<string> {
  const chatSettings = (await readChatSettings(chatId)) ?? {};
  const targetAgentId = agentId ?? chatSettings.defaultAgent ?? 'default';
  let agentFilesDir = settings?.defaultAgent?.files || './attachments';
  const agentDir = await resolveAgentDir(targetAgentId, workspaceRoot);

  if (targetAgentId !== 'default') {
    const customAgent = await getAgent(targetAgentId, workspaceRoot);
    if (customAgent?.files) {
      agentFilesDir = customAgent.files;
    }
  }

  return path.resolve(agentDir, agentFilesDir);
}

async function validateAttachments(files: string[]): Promise<void> {
  const { pathIsInsideDir } = await import('../shared/utils/fs.js');
  const { getClawminiDir } = await import('../shared/workspace.js');
  const tmpDir = path.join(getClawminiDir(process.cwd()), 'tmp');

  for (const file of files) {
    const absoluteFile = path.resolve(process.cwd(), file);
    if (!pathIsInsideDir(absoluteFile, tmpDir)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'File must be inside the temporary directory.',
      });
    }
    try {
      await fs.access(absoluteFile);
    } catch {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `File does not exist: ${file}`,
      });
    }
  }
}

async function validateLogFile(file: string, agentDir: string): Promise<string> {
  const { pathIsInsideDir } = await import('../shared/utils/fs.js');
  const resolvedPath = path.resolve(agentDir, file);

  if (!pathIsInsideDir(resolvedPath, agentDir, { allowSameDir: true })) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'File must be within the agent workspace.',
    });
  }

  try {
    await fs.access(resolvedPath);
  } catch {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `File does not exist: ${file}`,
    });
  }

  return path.relative(process.cwd(), resolvedPath);
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
          files: z.array(z.string()).optional(),
          adapter: z.string().optional(),
        }),
      })
    )
    .mutation(async ({ input, ctx }) => {
      let message = input.data.message;
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

      const files = input.data.files;
      if (files && files.length > 0) {
        const workspaceRoot = getWorkspaceRoot(process.cwd());
        const chatSettings = (await readChatSettings(chatId)) ?? {};
        const targetAgentId = agentId ?? chatSettings.defaultAgent ?? 'default';
        const agentDir = await resolveAgentDir(targetAgentId, workspaceRoot);
        const absoluteFilesDir = await getAgentFilesDir(agentId, chatId, settings, workspaceRoot);

        const adapterNamespace = input.data.adapter || 'cli';
        const targetDir = path.join(absoluteFilesDir, adapterNamespace);

        const { pathIsInsideDir } = await import('../shared/utils/fs.js');

        if (!pathIsInsideDir(targetDir, workspaceRoot, { allowSameDir: true })) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Target directory must be within the workspace.',
          });
        }

        await validateAttachments(files);

        await fs.mkdir(targetDir, { recursive: true });

        const finalPaths: string[] = [];
        for (const file of files) {
          const fileName = path.basename(file);
          const targetPath = await getUniquePath(path.join(targetDir, fileName));

          try {
            await fs.rename(file, targetPath);
          } catch {
            await fs.copyFile(file, targetPath);
            await fs.unlink(file);
          }

          finalPaths.push(path.relative(agentDir, targetPath));
        }

        const fileList = `Attached files:\n${finalPaths.map((p) => `- ${p}`).join('\n')}`;
        message = message ? `${message}\n\n${fileList}` : fileList;
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
  getMessages: apiProcedure
    .input(z.object({ chatId: z.string().optional(), limit: z.number().optional() }))
    .query(async ({ input, ctx }) => {
      const chatId = await resolveAndCheckChatId(ctx, input.chatId);
      return getMessages(chatId, input.limit);
    }),
  waitForMessages: apiProcedure
    .input(
      z.object({
        chatId: z.string().optional(),
        lastMessageId: z.string().optional(),
      })
    )
    .subscription(async function* ({ input, ctx, signal }) {
      const chatId = await resolveAndCheckChatId(ctx, input.chatId);

      // 1. Check if there are already new messages
      if (input.lastMessageId) {
        const messages = await getMessages(chatId);
        const lastIndex = messages.findIndex((m) => m.id === input.lastMessageId);
        if (lastIndex !== -1 && lastIndex < messages.length - 1) {
          yield messages.slice(lastIndex + 1);
        }
      }

      // 2. Listen for new messages
      const { on } = await import('node:events');
      try {
        for await (const [event] of on(daemonEvents, DAEMON_EVENT_MESSAGE_APPENDED, { signal })) {
          if (event.chatId === chatId) {
            yield [event.message];
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return;
        }
        throw err;
      }
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
        files: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const chatId = await resolveAndCheckChatId(ctx, input.chatId);
      const timestamp = new Date().toISOString();
      const id = Date.now().toString() + Math.random().toString(36).substring(2, 7);

      const filePaths: string[] = [];
      if (input.files && input.files.length > 0) {
        const workspaceRoot = getWorkspaceRoot(process.cwd());
        const agentDir = await resolveAgentDir(ctx.tokenPayload?.agentId, workspaceRoot);

        for (const file of input.files) {
          const validPath = await validateLogFile(file, agentDir);
          filePaths.push(validPath);
        }
      }

      const filesArgStr = filePaths.map((p) => ` --file ${p}`).join('');
      const logMsg: import('./chats.js').CommandLogMessage = {
        id,
        messageId: id,
        role: 'log',
        source: 'router',
        content: input.message,
        stderr: '',
        timestamp,
        command: `clawmini-lite log${filesArgStr}`,
        cwd: process.cwd(),
        exitCode: 0,
        stdout: input.message,
        ...(filePaths.length > 0 ? { files: filePaths } : {}),
      };

      await import('./chats.js').then((m) => m.appendMessage(chatId, logMsg));
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
