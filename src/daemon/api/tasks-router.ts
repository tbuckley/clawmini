import { z } from 'zod';
import fs from 'node:fs/promises';
import path from 'node:path';
import { TRPCError } from '@trpc/server';
import { apiProcedure, router } from './trpc.js';
import { getChatsDir, getChatRelativePath, isSubagentChatId } from '../chats.js';
import { isSessionIdActive } from '../queue.js';
import { readChatSettings } from '../../shared/workspace.js';
import { RequestStore } from '../request-store.js';

export const tasksPending = apiProcedure.query(async ({ ctx }) => {
  if (!ctx.tokenPayload) throw new TRPCError({ code: 'UNAUTHORIZED' });
  const parentChatId = ctx.tokenPayload.chatId;

  if (!isSubagentChatId(parentChatId)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Main agents cannot use tasks pending' });
  }

  const store = new RequestStore(process.cwd());
  const allRequests = await store.list();
  const pendingRequests = allRequests.filter(
    (r) => r.chatId === parentChatId && r.state === 'Pending'
  );

  const chatsDir = await getChatsDir();
  const subagentsDir = path.join(chatsDir, getChatRelativePath(parentChatId), 'subagents');

  let subagents: string[] = [];
  try {
    const entries = await fs.readdir(subagentsDir, { withFileTypes: true });
    subagents = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    // ignore
  }

  const pendingSubagents: Array<{ id: string; type: 'subagent'; status: string }> = [];
  for (const id of subagents) {
    const fullSubagentId = `${parentChatId}:subagents:${id}`;
    let status = 'completed';
    try {
      const settings = await readChatSettings(fullSubagentId);
      if (settings?.defaultAgent) {
        const agent = settings.defaultAgent;
        const sessionId = settings.sessions?.[agent];
        if (sessionId && isSessionIdActive(sessionId)) {
          status = 'running';
        }
      }
    } catch {
      // ignore
    }
    if (status === 'running') {
      pendingSubagents.push({ id, type: 'subagent', status });
    }
  }

  return {
    requests: pendingRequests.map((r) => ({
      id: r.id,
      type: 'request',
      commandName: r.commandName,
    })),
    subagents: pendingSubagents,
  };
});

export const tasksWait = apiProcedure
  .input(z.object({ id: z.string() }))
  .mutation(async ({ input, ctx }) => {
    if (!ctx.tokenPayload) throw new TRPCError({ code: 'UNAUTHORIZED' });
    const parentChatId = ctx.tokenPayload.chatId;

    if (!isSubagentChatId(parentChatId)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Main agents cannot block via wait commands',
      });
    }

    const { id } = input;
    const store = new RequestStore(process.cwd());
    const req = await store.load(id);

    if (req) {
      if (req.chatId !== parentChatId) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Request does not belong to this agent',
        });
      }
      let currentRequest = req;
      while (currentRequest && currentRequest.state === 'Pending') {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const loaded = await store.load(id);
        if (loaded) currentRequest = loaded;
      }
      return { type: 'request', result: currentRequest || req };
    }

    const fullSubagentId = `${parentChatId}:subagents:${id}`;
    const chatsDir = await getChatsDir();
    const subagentDir = path.join(chatsDir, getChatRelativePath(fullSubagentId));
    try {
      await fs.stat(subagentDir);
    } catch {
      throw new TRPCError({ code: 'NOT_FOUND', message: `Task not found for id ${id}` });
    }

    while (true) {
      let isRunning = false;
      try {
        const settings = await readChatSettings(fullSubagentId);
        if (settings?.defaultAgent) {
          const agent = settings.defaultAgent;
          const sessionId = settings.sessions?.[agent];
          if (sessionId && isSessionIdActive(sessionId)) {
            isRunning = true;
          }
        }
      } catch {
        // ignore
      }
      if (!isRunning) break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    return { type: 'subagent', result: 'completed' };
  });

export const tasksRouter = router({
  pending: tasksPending,
  wait: tasksWait,
});
