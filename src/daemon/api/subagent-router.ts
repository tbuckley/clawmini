import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { getWorkspaceRoot, readChatSettings, updateChatSettings } from '../../shared/workspace.js';
import { apiProcedure } from './trpc.js';
import { createChatLogger } from '../agent/chat-logger.js';
import { on } from 'node:events';
import { daemonEvents, DAEMON_EVENT_MESSAGE_APPENDED } from '../events.js';
import { createAgentSession } from '../agent/agent-session.js';
import {
  executeSubagent,
  getSubagentDepth,
  resolveSubagentEnvironments,
  handleSubagentPolicyRequest,
} from './subagent-utils.js';
import type { SubagentTracker } from '../../shared/config.js';

const MAX_SUBAGENT_DEPTH = 2;

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

    const id = input.subagentId || randomUUID();
    const sessionId = randomUUID();
    const agentId = input.targetAgentId || parentAgentId;
    let depth = 0;

    await updateChatSettings(chatId, (settings) => {
      settings.subagents = settings.subagents || {};

      depth = getSubagentDepth(settings, parentId);
      if (depth >= MAX_SUBAGENT_DEPTH) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Max subagent depth reached' });
      }

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

      return settings;
    });

    const workspaceRoot = getWorkspaceRoot(process.cwd());

    const { sourceEnv, targetEnv } = await resolveSubagentEnvironments(
      parentAgentId || 'default',
      agentId,
      workspaceRoot
    );
    // TODO: Ticket 3 - Use sourceEnv and targetEnv for policy evaluation
    void sourceEnv;
    void targetEnv;

    const isAsync = input.async ?? depth === 0;

    // Execute asynchronously
    executeSubagent(
      chatId,
      id,
      agentId,
      sessionId,
      input.prompt,
      isAsync,
      ctx.tokenPayload,
      workspaceRoot
    );

    return { id, depth, isAsync };
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

    let sub: SubagentTracker | undefined;

    await updateChatSettings(chatId, (settings) => {
      if (!settings.subagents?.[input.subagentId]) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Subagent not found' });
      }

      sub = settings.subagents[input.subagentId];
      sub!.status = 'active';
      return settings;
    });

    const workspaceRoot = getWorkspaceRoot(process.cwd());

    const { sourceEnv, targetEnv } = await resolveSubagentEnvironments(
      ctx.tokenPayload.agentId || 'default',
      sub!.agentId || 'default',
      workspaceRoot
    );

    await handleSubagentPolicyRequest(
      sourceEnv,
      targetEnv,
      chatId,
      ctx.tokenPayload.agentId || 'default',
      ctx.tokenPayload.subagentId,
      'send',
      sub!.agentId || 'default',
      sub!.id,
      input.prompt,
      workspaceRoot
    );

    // Execute asynchronously
    executeSubagent(
      chatId,
      sub!.id,
      sub!.agentId || 'default',
      sub!.sessionId || 'default',
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
      const lastLogMessage = await logger.findLastMessage((m) => m.role === 'agent');
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
  .mutation(async ({ input, ctx, signal }) => {
    if (!ctx.tokenPayload) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Missing token' });
    const chatId = ctx.tokenPayload.chatId;

    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), 60000);

    // Bind to the TRPC request abort signal to clean up listeners if client disconnects
    const onAbort = () => {
      clearTimeout(timeout);
      ac.abort();
    };
    if (signal) {
      signal.addEventListener('abort', onAbort);
    }

    const eventIterator = on(daemonEvents, DAEMON_EVENT_MESSAGE_APPENDED, {
      signal: ac.signal,
    });

    try {
      // Check status immediately before listening, but after event iterator is buffering
      const initialStatus = await checkSubagentStatus(chatId, input.subagentId);
      if (initialStatus) {
        clearTimeout(timeout);
        if (signal) signal.removeEventListener('abort', onAbort);
        return initialStatus;
      }

      for await (const [event] of eventIterator) {
        if (event.chatId === chatId && event.message?.subagentId === input.subagentId) {
          const msg = event.message;
          if (msg.role === 'subagent_status') {
            const status = await checkSubagentStatus(chatId, input.subagentId);
            if (status) {
              clearTimeout(timeout);
              if (signal) signal.removeEventListener('abort', onAbort);
              return status;
            }
          }
        }
      }
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'name' in err && err.name === 'AbortError') {
        return { status: 'active' as const, output: undefined };
      }
      throw err;
    } finally {
      clearTimeout(timeout);
      if (signal) signal.removeEventListener('abort', onAbort);
      ac.abort();
    }

    return { status: 'active' as const, output: undefined };
  });

export const subagentStop = apiProcedure
  .input(z.object({ subagentId: z.string() }))
  .mutation(async ({ input, ctx }) => {
    if (!ctx.tokenPayload) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Missing token' });
    const chatId = ctx.tokenPayload.chatId;

    let subToStop: SubagentTracker | undefined;

    await updateChatSettings(chatId, (settings) => {
      if (settings.subagents) {
        const sub = settings.subagents[input.subagentId];
        if (sub) {
          sub.status = 'failed';
          subToStop = sub;
        }
      }
      return settings;
    });

    if (subToStop) {
      const session = await createAgentSession({
        chatId,
        agentId: subToStop.agentId || 'default',
        sessionId: subToStop.sessionId || 'default',
        subagentId: input.subagentId,
        cwd: process.cwd(),
      });
      session.stop();
    }

    return { success: true };
  });

export const subagentDelete = apiProcedure
  .input(z.object({ subagentId: z.string() }))
  .mutation(async ({ input, ctx }) => {
    if (!ctx.tokenPayload) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Missing token' });
    const chatId = ctx.tokenPayload.chatId;

    let subToDelete: SubagentTracker | undefined;

    await updateChatSettings(chatId, (settings) => {
      if (settings.subagents && settings.subagents[input.subagentId]) {
        subToDelete = settings.subagents[input.subagentId]!;
        delete settings.subagents[input.subagentId];
      }
      return settings;
    });

    if (subToDelete) {
      const session = await createAgentSession({
        chatId,
        agentId: subToDelete.agentId || 'default',
        sessionId: subToDelete.sessionId || 'default',
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
