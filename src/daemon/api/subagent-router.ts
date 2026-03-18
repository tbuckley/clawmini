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
import { abortQueuesForDirPrefix } from '../queue.js';
import { handleUserMessage } from '../message.js';
import { readSettings } from '../../shared/workspace.js';
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

    const settings = ((await readSettings()) as Record<string, unknown> | null) ?? {};

    await handleUserMessage(
      subagentChatId,
      input.message,
      settings,
      undefined,
      true, // noWait
      (args) => runCommand({ ...args, logToTerminal: true }),
      undefined,
      input.agent || ctx.tokenPayload.agentId
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
    return entries.filter((e) => e.isDirectory()).map((e) => ({ id: e.name }));
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
