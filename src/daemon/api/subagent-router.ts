import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
import { TRPCError } from '@trpc/server';
import { apiProcedure, router } from './trpc.js';
import {
  getChatsDir,
  getChatRelativePath,
  deleteChat,
  getMessages,
  isSubagentChatId,
} from '../chats.js';
import { abortQueuesForDirPrefix, abortQueuesForSessionId, isSessionIdActive } from '../queue.js';
import { handleUserMessage } from '../message.js';
import { readSettings, writeChatSettings, readChatSettings } from '../../shared/workspace.js';
import { runCommand } from '../utils/spawn.js';

export const subagentAdd = apiProcedure
  .input(
    z.object({
      message: z.string(),
      agent: z.string().optional(),
    })
  )
  .mutation(async ({ input, ctx }) => {
    if (!ctx.tokenPayload) throw new TRPCError({ code: 'UNAUTHORIZED' });
    const parentChatId = ctx.tokenPayload.chatId;
    const subagentUuid = randomUUID();
    const subagentChatId = `${parentChatId}:subagents:${subagentUuid}`;

    const agentId = input.agent || ctx.tokenPayload.agentId;
    const sessionId = randomUUID();

    await writeChatSettings(subagentChatId, {
      defaultAgent: agentId,
      sessions: {
        [agentId]: sessionId,
      },
    });

    const settings = ((await readSettings()) as Record<string, unknown> | null) ?? {};

    await handleUserMessage(
      subagentChatId,
      input.message,
      settings,
      undefined,
      true, // noWait
      (args) => runCommand({ ...args, logToTerminal: true }),
      sessionId,
      agentId
    );

    return { subagentId: subagentUuid };
  });

export const subagentList = apiProcedure.query(async ({ ctx }) => {
  if (!ctx.tokenPayload) throw new TRPCError({ code: 'UNAUTHORIZED' });
  const parentChatId = ctx.tokenPayload.chatId;
  const chatsDir = await getChatsDir();
  const subagentsDir = path.join(chatsDir, getChatRelativePath(parentChatId), 'subagents');

  try {
    const entries = await fs.readdir(subagentsDir, { withFileTypes: true });
    const subagents = entries.filter((e) => e.isDirectory()).map((e) => e.name);

    const details = await Promise.all(
      subagents.map(async (id) => {
        const fullSubagentId = `${parentChatId}:subagents:${id}`;
        let agent = 'default';
        let status = 'unknown';
        let created = 'unknown';
        let snippet = '';

        try {
          const settings = await readChatSettings(fullSubagentId);
          if (settings?.defaultAgent) {
            agent = settings.defaultAgent;
            const sessionId = settings.sessions?.[agent];
            if (sessionId) {
              status = isSessionIdActive(sessionId) ? 'running' : 'completed';
            }
          }
        } catch {
          // Ignore settings errors
        }

        try {
          const messages = await getMessages(fullSubagentId, 100); // Need to get at least the first one
          if (messages.length > 0) {
            const firstUserMessage = messages.find((m) => m.role === 'user');
            if (firstUserMessage) {
              created = firstUserMessage.timestamp;
              snippet = firstUserMessage.content.slice(0, 50).replace(/\n/g, ' ');
              if (firstUserMessage.content.length > 50) snippet += '...';
            }
          }
        } catch {
          // Ignore messages errors
        }

        return { id, agent, status, created, snippet };
      })
    );

    return details;
  } catch {
    return [];
  }
});

export const subagentTail = apiProcedure
  .input(z.object({ subagentId: z.string(), limit: z.number().optional().default(10) }))
  .query(async ({ input, ctx }) => {
    if (!ctx.tokenPayload) throw new TRPCError({ code: 'UNAUTHORIZED' });
    const parentChatId = ctx.tokenPayload.chatId;
    const fullSubagentId = `${parentChatId}:subagents:${input.subagentId}`;

    if (!isSubagentChatId(fullSubagentId)) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid subagent ID' });
    }

    const chatsDir = await getChatsDir();
    const subagentDir = path.join(chatsDir, getChatRelativePath(fullSubagentId));
    try {
      await fs.stat(subagentDir);
    } catch {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Subagent not found' });
    }

    try {
      const messages = await getMessages(fullSubagentId, input.limit);
      return messages;
    } catch {
      return [];
    }
  });

export const subagentSend = apiProcedure
  .input(
    z.object({
      subagentId: z.string(),
      message: z.string(),
    })
  )
  .mutation(async ({ input, ctx }) => {
    if (!ctx.tokenPayload) throw new TRPCError({ code: 'UNAUTHORIZED' });
    const parentChatId = ctx.tokenPayload.chatId;
    const fullSubagentId = `${parentChatId}:subagents:${input.subagentId}`;

    if (!isSubagentChatId(fullSubagentId)) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid subagent ID' });
    }

    const chatsDir = await getChatsDir();
    const subagentDir = path.join(chatsDir, getChatRelativePath(fullSubagentId));
    try {
      await fs.stat(subagentDir);
    } catch {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Subagent not found' });
    }

    const settings = ((await readSettings()) as Record<string, unknown> | null) ?? {};

    await handleUserMessage(
      fullSubagentId,
      input.message,
      settings,
      undefined,
      true, // noWait
      (args) => runCommand({ ...args, logToTerminal: true }),
      undefined,
      undefined
    );

    return { success: true };
  });

export const subagentStop = apiProcedure
  .input(z.object({ subagentId: z.string() }))
  .mutation(async ({ input, ctx }) => {
    if (!ctx.tokenPayload) throw new TRPCError({ code: 'UNAUTHORIZED' });
    const parentChatId = ctx.tokenPayload.chatId;
    const fullSubagentId = `${parentChatId}:subagents:${input.subagentId}`;

    if (!isSubagentChatId(fullSubagentId)) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid subagent ID' });
    }

    const chatsDir = await getChatsDir();
    const subagentDir = path.join(chatsDir, getChatRelativePath(fullSubagentId));
    try {
      await fs.stat(subagentDir);
    } catch {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Subagent not found' });
    }

    const chatSettings = await readChatSettings(fullSubagentId);
    if (chatSettings?.defaultAgent && chatSettings.sessions?.[chatSettings.defaultAgent]) {
      const sessionId = chatSettings.sessions[chatSettings.defaultAgent];
      if (sessionId) {
        abortQueuesForSessionId(sessionId);
      }
    }

    abortQueuesForDirPrefix(subagentDir);
    return { success: true };
  });

export const subagentDelete = apiProcedure
  .input(z.object({ subagentId: z.string() }))
  .mutation(async ({ input, ctx }) => {
    if (!ctx.tokenPayload) throw new TRPCError({ code: 'UNAUTHORIZED' });
    const parentChatId = ctx.tokenPayload.chatId;
    const fullSubagentId = `${parentChatId}:subagents:${input.subagentId}`;

    if (!isSubagentChatId(fullSubagentId)) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid subagent ID' });
    }

    const chatsDir = await getChatsDir();
    const subagentDir = path.join(chatsDir, getChatRelativePath(fullSubagentId));
    try {
      await fs.stat(subagentDir);
    } catch {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Subagent not found' });
    }

    const chatSettings = await readChatSettings(fullSubagentId);
    if (chatSettings?.defaultAgent && chatSettings.sessions?.[chatSettings.defaultAgent]) {
      const sessionId = chatSettings.sessions[chatSettings.defaultAgent];
      if (sessionId) {
        abortQueuesForSessionId(sessionId);
      }
    }

    abortQueuesForDirPrefix(subagentDir);
    await deleteChat(fullSubagentId);
    return { success: true };
  });

export const subagentRouter = router({
  add: subagentAdd,
  list: subagentList,
  tail: subagentTail,
  send: subagentSend,
  stop: subagentStop,
  delete: subagentDelete,
});
