import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
import { TRPCError } from '@trpc/server';
import { apiProcedure, router } from './trpc.js';
import {
  getDefaultChatId,
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
      parentChatId: z.string().optional(),
      agentId: z.string().optional(),
    })
  )
  .mutation(async ({ input }) => {
    const parentChatId = input.parentChatId ?? (await getDefaultChatId());
    const subagentUuid = randomUUID();
    const subagentChatId = `${parentChatId}:subagents:${subagentUuid}`;

    const settings = ((await readSettings()) as Record<string, unknown> | null) ?? {};

    // Asynchronously start execution using handleUserMessage with noWait=true
    await handleUserMessage(
      subagentChatId,
      input.message,
      settings,
      undefined, // adapter
      true, // noWait = true so it starts asynchronously
      (args) => runCommand({ ...args, logToTerminal: true }),
      undefined, // sessionId
      input.agentId
    );

    return { subagentId: subagentChatId };
  });

export const subagentList = apiProcedure
  .input(z.object({ parentChatId: z.string().optional() }))
  .query(async ({ input }) => {
    const parentChatId = input.parentChatId ?? (await getDefaultChatId());
    const chatsDir = await getChatsDir();
    const subagentsDir = path.join(chatsDir, parentChatId, 'subagents');

    try {
      const entries = await fs.readdir(subagentsDir, { withFileTypes: true });
      return entries
        .filter((e) => e.isDirectory())
        .map((e) => ({ id: `${parentChatId}:subagents:${e.name}` }));
    } catch {
      return [];
    }
  });

export const subagentTail = apiProcedure
  .input(z.object({ subagentId: z.string(), limit: z.number().optional().default(10) }))
  .query(async ({ input }) => {
    if (!isSubagentChatId(input.subagentId)) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid subagent ID' });
    }
    try {
      const messages = await getMessages(input.subagentId, input.limit);
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
  .mutation(async ({ input }) => {
    if (!isSubagentChatId(input.subagentId)) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid subagent ID' });
    }

    const settings = ((await readSettings()) as Record<string, unknown> | null) ?? {};

    await handleUserMessage(
      input.subagentId,
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
  .mutation(async ({ input }) => {
    if (!isSubagentChatId(input.subagentId)) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid subagent ID' });
    }
    const chatsDir = await getChatsDir();
    const subagentDir = path.join(chatsDir, getChatRelativePath(input.subagentId));
    abortQueuesForDirPrefix(subagentDir);
    return { success: true };
  });

export const subagentDelete = apiProcedure
  .input(z.object({ subagentId: z.string() }))
  .mutation(async ({ input }) => {
    if (!isSubagentChatId(input.subagentId)) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid subagent ID' });
    }
    const chatsDir = await getChatsDir();
    const subagentDir = path.join(chatsDir, getChatRelativePath(input.subagentId));
    abortQueuesForDirPrefix(subagentDir);
    await deleteChat(input.subagentId);
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
