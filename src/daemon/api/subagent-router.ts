import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { getWorkspaceRoot, readChatSettings, writeChatSettings } from '../../shared/workspace.js';
import { apiProcedure } from './trpc.js';
import { executeDirectMessage } from '../message.js';
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
    const parentId = ctx.tokenPayload.subagentId || ctx.tokenPayload.agentId;

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
    const agentId = input.targetAgentId || parentId;

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
        await executeDirectMessage(
          chatId,
          {
            messageId: randomUUID(),
            message: input.prompt,
            chatId,
            agentId,
            sessionId,
            env: {},
          },
          undefined, // settings
          workspaceRoot,
          false, // noWait
          undefined, // userMessageContent
          id // subagentId
        );

        // Update status
        const finalSettings = (await readChatSettings(chatId)) || {};
        if (finalSettings.subagents?.[id]) {
          finalSettings.subagents[id]!.status = 'completed';
          await writeChatSettings(chatId, finalSettings);
        }

        // Notify parent
        if (parentId) {
          const logger = createChatLogger(chatId, id);
          const msgs = await logger.getMessages();
          const lastLogMessage = msgs
            .reverse()
            .find((m) => m.role === 'log' && m.command !== 'retry-delay' && m.source !== 'router');
          let outputContent = '';
          if (lastLogMessage && 'content' in lastLogMessage) {
            outputContent = `\n\n<subagent_output>\n${lastLogMessage.content}\n</subagent_output>`;
          }

          await executeDirectMessage(
            chatId,
            {
              messageId: randomUUID(),
              message: `<notification>Subagent ${id} completed.</notification>${outputContent}`,
              chatId,
              agentId: parentId,
              sessionId: ctx.tokenPayload?.sessionId || 'default',
              env: {},
            },
            undefined,
            workspaceRoot,
            true // noWait
          );
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
        await executeDirectMessage(
          chatId,
          {
            messageId: randomUUID(),
            message: input.prompt,
            chatId,
            agentId: sub.agentId || 'default',
            sessionId: sub.sessionId || 'default',
            env: {},
          },
          undefined, // settings
          workspaceRoot,
          false, // noWait
          undefined, // userMessageContent
          sub.id // subagentId
        );
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

export const subagentList = apiProcedure
  .input(z.object({ blocking: z.boolean().optional() }).optional())
  .query(async ({ input, ctx }) => {
    if (!ctx.tokenPayload) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Missing token' });
    const chatId = ctx.tokenPayload.chatId;
    const settings = await readChatSettings(chatId);

    let subagents = Object.values(settings?.subagents || {});

    const isSubagent = !!ctx.tokenPayload.subagentId;
    const myId = ctx.tokenPayload.subagentId || ctx.tokenPayload.agentId;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    subagents = subagents.filter((s: any) => s.parentId === myId);

    if (input?.blocking) {
      if (!isSubagent) {
        subagents = [];
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        subagents = subagents.filter((s: any) => s.status === 'active' || s.status === 'pending');
      }
    }
    return { subagents };
  });

export const subagentTail = apiProcedure
  .input(z.object({ subagentId: z.string(), limit: z.number().optional() }))
  .query(async ({ input, ctx }) => {
    if (!ctx.tokenPayload) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Missing token' });
    const chatId = ctx.tokenPayload.chatId;

    const logger = createChatLogger(chatId, input.subagentId);
    const messages = await logger.getMessages(input.limit);

    return { messages };
  });
