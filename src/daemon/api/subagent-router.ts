import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { getWorkspaceRoot, readChatSettings, writeChatSettings } from '../../shared/workspace.js';
import { apiProcedure } from './trpc.js';
import { executeDirectMessage } from '../message.js';
import { createChatLogger } from '../agent/chat-logger.js';
import { on } from 'node:events';
import { daemonEvents, DAEMON_EVENT_MESSAGE_APPENDED } from '../events.js';
import { createAgentSession } from '../agent/agent-session.js';

const MAX_SUBAGENT_DEPTH = 2;

function getSubagentDepth(settings: any, parentId: string | undefined): number {
  let depth = 0;
  let currentParentId = parentId;
  while (currentParentId && settings.subagents?.[currentParentId]) {
    depth++;
    currentParentId = settings.subagents[currentParentId]?.parentId;
  }
  return depth;
}

async function executeSubagent(
  chatId: string,
  subagentId: string,
  agentId: string,
  sessionId: string,
  prompt: string,
  isAsync: boolean | undefined,
  parentTokenPayload: any,
  workspaceRoot: string
) {
  try {
    await executeDirectMessage(
      chatId,
      {
        messageId: randomUUID(),
        message: prompt,
        chatId,
        agentId,
        sessionId,
        env: {},
      },
      undefined, // settings
      workspaceRoot,
      false, // noWait
      undefined, // userMessageContent
      subagentId // subagentId
    );

    // Update status
    const finalSettings = (await readChatSettings(chatId)) || {};
    if (finalSettings.subagents?.[subagentId]) {
      finalSettings.subagents[subagentId]!.status = 'completed';
      await writeChatSettings(chatId, finalSettings);
    }

    const logger = createChatLogger(chatId, subagentId);
    if (!isAsync) {
      // Emit debug message to wake up waiters
      await logger.log('Subagent completed');
    }

    if (isAsync) {
      // TODO: make it more efficient to get the resulting message from a run
      const msgs = await logger.getMessages();
      const lastLogMessage = msgs
        .reverse()
        .find((m) => m.role === 'log' && m.command !== 'retry-delay' && m.source !== 'router');
      let outputContent = '';
      if (lastLogMessage && 'content' in lastLogMessage) {
        outputContent = `\n\n<subagent_output>\n${lastLogMessage.content}\n</subagent_output>`;
      }

      console.log(
        'Notifying parent',
        chatId,
        parentTokenPayload?.agentId,
        parentTokenPayload?.subagentId
      );
      await executeDirectMessage(
        chatId,
        {
          messageId: randomUUID(),
          message: `<notification>Subagent ${subagentId} completed.</notification>${outputContent}`,
          chatId,
          agentId: parentTokenPayload?.agentId || 'default',
          ...(parentTokenPayload?.subagentId ? { subagentId: parentTokenPayload.subagentId } : {}),
          sessionId: parentTokenPayload?.sessionId || 'default',
          env: {},
        },
        undefined,
        workspaceRoot,
        true // noWait
      );
    }
  } catch {
    const errSettings = (await readChatSettings(chatId)) || {};
    if (errSettings.subagents?.[subagentId]) {
      errSettings.subagents[subagentId]!.status = 'failed';
      await writeChatSettings(chatId, errSettings);
    }
    const logger = createChatLogger(chatId, subagentId);
    await logger.log('Subagent failed');
  }
}

export const subagentSpawn = apiProcedure
  .input(
    z.object({
      subagentId: z.string().optional(),
      targetAgentId: z.string().optional(),
      prompt: z.string(),
      async: z.boolean().optional(),
    })
  )
  .mutation(async ({ input, ctx }) => {
    if (!ctx.tokenPayload) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Missing token' });
    const chatId = ctx.tokenPayload.chatId;
    const parentAgentId = ctx.tokenPayload.agentId;
    const parentId = ctx.tokenPayload.subagentId;

    const settings = (await readChatSettings(chatId)) || {};
    settings.subagents = settings.subagents || {};

    const depth = getSubagentDepth(settings, parentId);
    if (depth >= MAX_SUBAGENT_DEPTH) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Max subagent depth reached' });
    }

    const id = input.subagentId || randomUUID();
    const sessionId = randomUUID();
    const agentId = input.targetAgentId || parentAgentId;

    // Make sure the id does not already exist
    if (settings.subagents[id]) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Subagent ID already exists' });
    }

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
    executeSubagent(
      chatId,
      id,
      agentId,
      sessionId,
      input.prompt,
      input.async,
      ctx.tokenPayload,
      workspaceRoot
    );

    return { id, depth };
  });

export const subagentSend = apiProcedure
  .input(
    z.object({
      subagentId: z.string(),
      prompt: z.string(),
      async: z.boolean().optional(),
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

    sub.status = 'active';
    await writeChatSettings(chatId, settings);

    const workspaceRoot = getWorkspaceRoot(process.cwd());

    // Execute asynchronously
    executeSubagent(
      chatId,
      sub.id,
      sub.agentId || 'default',
      sub.sessionId || 'default',
      input.prompt,
      input.async,
      ctx.tokenPayload,
      workspaceRoot
    );

    return { success: true };
  });

async function checkSubagentStatus(chatId: string, subagentId: string) {
  const settings = await readChatSettings(chatId);
  const sub = settings?.subagents?.[subagentId];
  if (!sub) throw new TRPCError({ code: 'NOT_FOUND', message: 'Subagent not found' });

  if (sub.status === 'completed' || sub.status === 'failed') {
    let outputContent: string | undefined;
    if (sub.status === 'completed') {
      const logger = createChatLogger(chatId, subagentId);
      // TODO: make it more efficient to get the resulting message from a run
      const msgs = await logger.getMessages();
      const lastLogMessage = msgs
        .reverse()
        .find((m) => m.role === 'log' && m.command !== 'retry-delay' && m.source !== 'router');
      if (lastLogMessage && 'content' in lastLogMessage) {
        outputContent = lastLogMessage.content;
      }
    }
    return { status: sub.status, output: outputContent };
  }
  return null;
}

export const subagentWait = apiProcedure
  .input(z.object({ subagentId: z.string() }))
  .mutation(async ({ input, ctx }) => {
    if (!ctx.tokenPayload) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Missing token' });
    const chatId = ctx.tokenPayload.chatId;

    // Check status immediately before listening
    const initialStatus = await checkSubagentStatus(chatId, input.subagentId);
    if (initialStatus) return initialStatus;

    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), 60000);

    try {
      for await (const [event] of on(daemonEvents, DAEMON_EVENT_MESSAGE_APPENDED, { signal: ac.signal })) {
        if (event.chatId === chatId) {
          const status = await checkSubagentStatus(chatId, input.subagentId);
          if (status) {
            clearTimeout(timeout);
            return status;
          }
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        return { status: 'active' as const, output: undefined };
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
    
    return { status: 'active' as const, output: undefined };
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

        const session = await createAgentSession({
          chatId,
          agentId: sub.agentId || 'default',
          sessionId: sub.sessionId || 'default',
          subagentId: input.subagentId,
          cwd: process.cwd(),
        });
        session.stop();
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
      const sub = settings.subagents[input.subagentId]!;
      delete settings.subagents[input.subagentId];
      await writeChatSettings(chatId, settings);

      const session = await createAgentSession({
        chatId,
        agentId: sub.agentId || 'default',
        sessionId: sub.sessionId || 'default',
        subagentId: input.subagentId,
        cwd: process.cwd(),
      });
      session.stop();

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
    const myId = ctx.tokenPayload.subagentId;

    subagents = subagents.filter((s) => s.parentId === myId);

    if (input?.blocking) {
      if (!isSubagent) {
        subagents = [];
      } else {
        subagents = subagents.filter((s) => s.status === 'active');
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
