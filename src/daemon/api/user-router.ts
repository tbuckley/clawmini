import { z } from 'zod';
import fs from 'node:fs/promises';
import path from 'node:path';
import { TRPCError } from '@trpc/server';
import { pathIsInsideDir } from '../../shared/utils/fs.js';
import { on } from 'node:events';
import { daemonEvents, DAEMON_EVENT_MESSAGE_APPENDED, DAEMON_EVENT_TYPING } from '../events.js';
import { getSettingsPath, readChatSettings, getWorkspaceRoot } from '../../shared/workspace.js';
import { CronJobSchema } from '../../shared/config.js';
import { handleUserMessage } from '../message.js';
import { getDefaultChatId, getMessages as fetchMessages } from '../chats.js';
import { apiProcedure, publicProcedure, router } from './trpc.js';
import {
  getUniquePath,
  resolveAgentDir,
  getAgentFilesDir,
  validateAttachments,
  listCronJobsShared,
  addCronJobShared,
  deleteCronJobShared,
} from './router-utils.js';

export const sendMessage = apiProcedure
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
  .mutation(async ({ input }) => {
    let message = input.data.message;
    const chatId = input.data.chatId ?? (await getDefaultChatId());
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

    await handleUserMessage(chatId, message, settings, undefined, noWait, sessionId, agentId);

    return { success: true };
  });

export const getMessages = apiProcedure
  .input(z.object({ chatId: z.string().optional(), limit: z.number().optional() }))
  .query(async ({ input }) => {
    const chatId = input.chatId ?? (await getDefaultChatId());
    return fetchMessages(chatId, input.limit);
  });

export const waitForMessages = apiProcedure
  .input(
    z.object({
      chatId: z.string().optional(),
      lastMessageId: z.string().optional(),
    })
  )
  .subscription(async function* ({ input, signal }) {
    const chatId = input.chatId ?? (await getDefaultChatId());

    // 1. Check if there are already new messages
    if (input.lastMessageId) {
      const messages = await fetchMessages(chatId);
      const lastIndex = messages.findIndex((m) => m.id === input.lastMessageId);
      if (lastIndex !== -1 && lastIndex < messages.length - 1) {
        yield messages.slice(lastIndex + 1);
      }
    }

    // 2. Listen for new messages
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
  });

export const waitForTyping = apiProcedure
  .input(
    z.object({
      chatId: z.string().optional(),
    })
  )
  .subscription(async function* ({ input, signal }) {
    const chatId = input.chatId ?? (await getDefaultChatId());

    try {
      for await (const [event] of on(daemonEvents, DAEMON_EVENT_TYPING, { signal })) {
        if (event.chatId === chatId) {
          yield event;
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      throw err;
    }
  });

export const ping = publicProcedure.query(() => {
  return { status: 'ok' };
});

export const shutdown = publicProcedure.mutation(() => {
  // Schedule a shutdown shortly after the response is sent
  setTimeout(() => {
    console.log('Shutting down daemon...');
    process.kill(process.pid, 'SIGTERM');
  }, 100);
  return { success: true };
});

export const userListCronJobs = apiProcedure
  .input(z.object({ chatId: z.string().optional() }))
  .query(async ({ input }) => {
    const chatId = input.chatId ?? (await getDefaultChatId());
    return listCronJobsShared(chatId);
  });

export const userAddCronJob = apiProcedure
  .input(z.object({ chatId: z.string().optional(), job: CronJobSchema }))
  .mutation(async ({ input }) => {
    const chatId = input.chatId ?? (await getDefaultChatId());
    return addCronJobShared(chatId, input.job);
  });

export const userDeleteCronJob = apiProcedure
  .input(z.object({ chatId: z.string().optional(), id: z.string() }))
  .mutation(async ({ input }) => {
    const chatId = input.chatId ?? (await getDefaultChatId());
    return deleteCronJobShared(chatId, input.id);
  });

export const userRouter = router({
  sendMessage,
  getMessages,
  waitForMessages,
  waitForTyping,
  ping,
  shutdown,
  listCronJobs: userListCronJobs,
  addCronJob: userAddCronJob,
  deleteCronJob: userDeleteCronJob,
});

export type UserRouter = typeof userRouter;
