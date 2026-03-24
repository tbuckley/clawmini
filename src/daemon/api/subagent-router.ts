import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { getWorkspaceRoot, readChatSettings, writeChatSettings } from '../../shared/workspace.js';
import { apiProcedure } from './trpc.js';
import { createAgentSession } from '../agent/agent-session.js';
import { createChatLogger } from '../agent/chat-logger.js';

const MAX_SUBAGENT_DEPTH = 2;

export const subagentSpawn = apiProcedure
  .input(
    z.object({
      subagentId: z.string().optional(),
      targetAgentId: z.string().optional(),
      prompt: z.string(),
    })
  )
  .mutation(async ({ input, ctx }) => {
    if (!ctx.tokenPayload) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Missing token' });
    const chatId = ctx.tokenPayload.chatId;
    const parentId = ctx.tokenPayload.agentId;

    const settings = (await readChatSettings(chatId)) || {};
    settings.subagents = settings.subagents || {};

    let depth = 0;
    let currentParentId: string | undefined = parentId;
    while (currentParentId && settings.subagents[currentParentId]) {
      depth++;
      currentParentId = settings.subagents[currentParentId]?.parentId;
    }
    if (depth >= MAX_SUBAGENT_DEPTH) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Max subagent depth reached' });
    }

    const id = input.subagentId || randomUUID();
    const sessionId = randomUUID();
    const agentId = input.targetAgentId || 'default';

    settings.subagents[id] = {
      id,
      agentId,
      sessionId,
      createdAt: new Date().toISOString(),
      status: 'active',
      parentId,
    };

    await writeChatSettings(chatId, settings);

    const workspaceRoot = getWorkspaceRoot(process.cwd());

    // Execute asynchronously
    (async () => {
      try {
        const session = await createAgentSession({
          chatId,
          agentId,
          sessionId,
          cwd: workspaceRoot,
          logger: createChatLogger(chatId, id),
        });

        await session.handleMessage({
          id: randomUUID(),
          content: input.prompt,
          env: {},
        });

        // Update status
        const finalSettings = (await readChatSettings(chatId)) || {};
        if (finalSettings.subagents?.[id]) {
          finalSettings.subagents[id]!.status = 'completed';
          await writeChatSettings(chatId, finalSettings);
        }

        // Notify parent
        if (parentId) {
          const parentSession = await createAgentSession({
            chatId,
            agentId: parentId,
            sessionId: ctx.tokenPayload?.sessionId || 'default',
            cwd: workspaceRoot,
          });
          await parentSession.handleMessage({
            id: randomUUID(),
            content: `<notification>Subagent ${id} completed.</notification>`,
            env: {},
          });
        }
      } catch {
        const errSettings = (await readChatSettings(chatId)) || {};
        if (errSettings.subagents?.[id]) {
          errSettings.subagents[id]!.status = 'failed';
          await writeChatSettings(chatId, errSettings);
        }
      }
    })();

    return { id, depth };
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

    const sub = settings.subagents[input.subagentId];
    if (!sub) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Subagent not found' });
    }

    const workspaceRoot = getWorkspaceRoot(process.cwd());

    // Execute asynchronously
    (async () => {
      try {
        const session = await createAgentSession({
          chatId,
          agentId: sub.agentId || 'default',
          sessionId: sub.sessionId || 'default',
          cwd: workspaceRoot,
          logger: createChatLogger(chatId, sub.id || 'default'),
        });

        await session.handleMessage({
          id: randomUUID(),
          content: input.prompt,
          env: {},
        });
      } catch {
        // Optionally handle failure logic
      }
    })();

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
