import { z } from 'zod';
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

export const userSubagentList = apiProcedure
  .input(z.object({ parentChatId: z.string().optional() }))
  .query(async ({ input }) => {
    const parentChatId = input.parentChatId ?? (await getDefaultChatId());
    const chatsDir = await getChatsDir();
    const subagentsDir = path.join(chatsDir, getChatRelativePath(parentChatId), 'subagents');

    try {
      const entries = await fs.readdir(subagentsDir, { withFileTypes: true });
      return entries
        .filter((e) => e.isDirectory())
        .map((e) => ({ id: `${parentChatId}:subagents:${e.name}` }));
    } catch {
      return [];
    }
  });

export const userSubagentTail = apiProcedure
  .input(z.object({ subagentId: z.string(), limit: z.number().optional().default(10) }))
  .query(async ({ input }) => {
    if (!isSubagentChatId(input.subagentId)) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid subagent ID' });
    }
    try {
      return await getMessages(input.subagentId, input.limit);
    } catch {
      return [];
    }
  });

export const userSubagentSend = apiProcedure
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

export const userSubagentStop = apiProcedure
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

export const userSubagentDelete = apiProcedure
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

export const userSubagentRouter = router({
  list: userSubagentList,
  tail: userSubagentTail,
  send: userSubagentSend,
  stop: userSubagentStop,
  delete: userSubagentDelete,
});
