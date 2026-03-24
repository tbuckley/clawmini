import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { getWorkspaceRoot, readChatSettings, writeChatSettings } from '../../shared/workspace.js';
import { taskScheduler } from '../agent/task-scheduler.js';
import { apiProcedure } from './trpc.js';
import { resolveAgentDir } from './router-utils.js';

export const subagentSpawn = apiProcedure
  .input(
    z.object({
      subagentId: z.string().optional(),
      targetAgentId: z.string(),
      prompt: z.string(),
    })
  )
  .mutation(async ({ input, ctx }) => {
    if (!ctx.tokenPayload) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Missing token' });
    const chatId = ctx.tokenPayload.chatId;
    const parentId = ctx.tokenPayload.agentId;

    const settings = (await readChatSettings(chatId)) || {};
    settings.subagents = settings.subagents || {};

    const id = input.subagentId || randomUUID();
    const sessionId = randomUUID();

    settings.subagents[id] = {
      id,
      agentId: input.targetAgentId,
      sessionId,
      createdAt: new Date().toISOString(),
      status: 'active',
      parentId,
    };

    await writeChatSettings(chatId, settings);

    const workspaceRoot = getWorkspaceRoot(process.cwd());
    const dirPath = await resolveAgentDir(input.targetAgentId, workspaceRoot);

    taskScheduler.schedule({
      id,
      rootChatId: chatId,
      dirPath,
      execute: async () => {
        // TBD: Ticket 6 will implement the execution loop
      },
    });

    return { id };
  });

export const subagentSend = apiProcedure
  .input(
    z.object({
      subagentId: z.string(),
      prompt: z.string(),
    })
  )
  .mutation(async ({ input, ctx }) => {
    if (!ctx.tokenPayload) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Missing token' });
    const chatId = ctx.tokenPayload.chatId;

    const settings = await readChatSettings(chatId);
    if (!settings?.subagents?.[input.subagentId]) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Subagent not found' });
    }

    // TBD: Ticket 6
    return { success: true };
  });

export const subagentWait = apiProcedure
  .input(z.object({ subagentId: z.string() }))
  .mutation(async ({ input, ctx }) => {
    if (!ctx.tokenPayload) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Missing token' });
    const chatId = ctx.tokenPayload.chatId;

    let iterations = 0;
    while (iterations < 60) {
      const settings = await readChatSettings(chatId);
      const sub = settings?.subagents?.[input.subagentId];
      if (!sub) throw new TRPCError({ code: 'NOT_FOUND', message: 'Subagent not found' });

      if (sub.status === 'completed' || sub.status === 'failed') {
        return { status: sub.status };
      }

      await new Promise((r) => setTimeout(r, 1000));
      iterations++;
    }

    return { status: 'active' };
  });

export const subagentStop = apiProcedure
  .input(z.object({ subagentId: z.string() }))
  .mutation(async ({ input, ctx }) => {
    if (!ctx.tokenPayload) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Missing token' });
    const chatId = ctx.tokenPayload.chatId;

    const settings = await readChatSettings(chatId);
    if (settings?.subagents) {
      const sub = settings.subagents[input.subagentId];
      if (sub) {
        sub.status = 'failed';
        await writeChatSettings(chatId, settings);
      }
    }

    return { success: true };
  });

export const subagentDelete = apiProcedure
  .input(z.object({ subagentId: z.string() }))
  .mutation(async ({ input, ctx }) => {
    if (!ctx.tokenPayload) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Missing token' });
    const chatId = ctx.tokenPayload.chatId;

    const settings = await readChatSettings(chatId);
    if (settings?.subagents && settings.subagents[input.subagentId]) {
      delete settings.subagents[input.subagentId];
      await writeChatSettings(chatId, settings);
      return { success: true, deleted: true };
    }

    return { success: true, deleted: false };
  });
export const subagentList = apiProcedure.query(async ({ ctx }) => {
  if (!ctx.tokenPayload) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Missing token' });
  const chatId = ctx.tokenPayload.chatId;
  const settings = await readChatSettings(chatId);
  return { subagents: Object.values(settings?.subagents || {}) };
});
