import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import {
  appendMessage,
  type CommandLogMessage,
  type AgentReplyMessage,
  type ToolMessage,
} from '../chats.js';
import { getWorkspaceRoot } from '../../shared/workspace.js';
import { CronJobSchema } from '../../shared/config.js';
import { apiProcedure, router } from './trpc.js';
import { taskScheduler } from '../agent/task-scheduler.js';
import { formatPendingMessages } from '../agent/utils.js';
import {
  resolveAgentDir,
  validateLogFile,
  listCronJobsShared,
  addCronJobShared,
  deleteCronJobShared,
} from './router-utils.js';

export const logMessage = apiProcedure
  .input(
    z.object({
      message: z.string().optional(),
      files: z.array(z.string()).optional(),
    })
  )
  .mutation(async ({ input, ctx }) => {
    if (!ctx.tokenPayload) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Missing token' });
    const chatId = ctx.tokenPayload.chatId;
    const timestamp = new Date().toISOString();
    const id = Date.now().toString() + Math.random().toString(36).substring(2, 7);

    const filePaths: string[] = [];
    if (input.files && input.files.length > 0) {
      const workspaceRoot = getWorkspaceRoot(process.cwd());
      const agentDir = await resolveAgentDir(ctx.tokenPayload?.agentId, workspaceRoot);

      for (const file of input.files) {
        const validPath = await validateLogFile(file, agentDir, workspaceRoot);
        filePaths.push(validPath);
      }
    }

    const filesArgStr = filePaths.map((p) => ` --file ${p}`).join('');
    const messageStr = input.message || '';
    const logMsg: CommandLogMessage = {
      id,
      messageId: id,
      role: 'command',
      content: messageStr,
      stdout: '',
      stderr: '',
      timestamp,
      command: `clawmini-lite log${filesArgStr}`,
      cwd: process.cwd(),
      exitCode: 0,
      ...(ctx.tokenPayload.subagentId ? { subagentId: ctx.tokenPayload.subagentId } : {}),
      ...(filePaths.length > 0 ? { files: filePaths } : {}),
    };

    await appendMessage(chatId, logMsg);
    return { success: true };
  });

export const logReplyMessage = apiProcedure
  .input(
    z.object({
      message: z.string(),
      files: z.array(z.string()).optional(),
    })
  )
  .mutation(async ({ input, ctx }) => {
    if (!ctx.tokenPayload) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Missing token' });
    const chatId = ctx.tokenPayload.chatId;
    const timestamp = new Date().toISOString();
    const id = Date.now().toString() + Math.random().toString(36).substring(2, 7);

    const filePaths: string[] = [];
    if (input.files && input.files.length > 0) {
      const workspaceRoot = getWorkspaceRoot(process.cwd());
      const agentDir = await resolveAgentDir(ctx.tokenPayload?.agentId, workspaceRoot);

      for (const file of input.files) {
        const validPath = await validateLogFile(file, agentDir, workspaceRoot);
        filePaths.push(validPath);
      }
    }

    const logMsg: AgentReplyMessage = {
      id,
      role: 'agent',
      content: input.message,
      timestamp,
      ...(ctx.tokenPayload.subagentId ? { subagentId: ctx.tokenPayload.subagentId } : {}),
      ...(filePaths.length > 0 ? { files: filePaths } : {}),
    };

    await appendMessage(chatId, logMsg);
    return { success: true };
  });

export const logToolMessage = apiProcedure
  .input(
    z.object({
      name: z.string(),
      payload: z.any().optional(),
    })
  )
  .mutation(async ({ input, ctx }) => {
    if (!ctx.tokenPayload) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Missing token' });
    const chatId = ctx.tokenPayload.chatId;
    const timestamp = new Date().toISOString();
    const id = Date.now().toString() + Math.random().toString(36).substring(2, 7);
    const messageId = randomUUID();

    const payloadObj = input.payload !== undefined ? input.payload : {};
    let contentStr: string;
    if (typeof payloadObj === 'string') {
      contentStr = payloadObj;
    } else {
      try {
        contentStr = JSON.stringify(payloadObj, null, 2);
      } catch {
        contentStr = String(payloadObj);
      }
    }

    const logMsg: ToolMessage = {
      id,
      messageId,
      role: 'tool',
      name: input.name,
      payload: payloadObj,
      content: contentStr,
      timestamp,
      ...(ctx.tokenPayload.subagentId ? { subagentId: ctx.tokenPayload.subagentId } : {}),
    };

    await appendMessage(chatId, logMsg);
    return { success: true };
  });

export const agentListCronJobs = apiProcedure.query(async ({ ctx }) => {
  if (!ctx.tokenPayload) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Missing token' });
  const chatId = ctx.tokenPayload.chatId;
  return listCronJobsShared(chatId);
});

export const agentAddCronJob = apiProcedure
  .input(z.object({ job: CronJobSchema }))
  .mutation(async ({ input, ctx }) => {
    if (!ctx.tokenPayload) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Missing token' });
    const chatId = ctx.tokenPayload.chatId;
    const job = { ...input.job, agentId: ctx.tokenPayload.agentId };
    return addCronJobShared(chatId, job);
  });

export const agentDeleteCronJob = apiProcedure
  .input(z.object({ id: z.string() }))
  .mutation(async ({ input, ctx }) => {
    if (!ctx.tokenPayload) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Missing token' });
    const chatId = ctx.tokenPayload.chatId;
    return deleteCronJobShared(chatId, input.id);
  });

import { listPolicies, executePolicyHelp, createPolicyRequest } from './agent-policy-endpoints.js';

import { ping } from './user-router.js';

export const fetchPendingMessages = apiProcedure.mutation(async ({ ctx }) => {
  if (!ctx.tokenPayload?.agentId) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Missing agent ID' });
  }
  const targetSessionId = ctx.tokenPayload?.sessionId || 'default';

  const extracted = taskScheduler.extractPending(targetSessionId);
  if (extracted.length === 0) {
    return { messages: '' };
  }

  return { messages: formatPendingMessages(extracted) };
});

import {
  subagentSpawn,
  subagentSend,
  subagentWait,
  subagentStop,
  subagentDelete,
  subagentList,
  subagentTail,
} from './subagent-router.js';

export const agentRouter = router({
  logMessage,
  logReplyMessage,
  logToolMessage,
  listCronJobs: agentListCronJobs,
  addCronJob: agentAddCronJob,
  deleteCronJob: agentDeleteCronJob,
  listPolicies,
  executePolicyHelp,
  createPolicyRequest,
  fetchPendingMessages,
  ping,
  subagentSpawn,
  subagentSend,
  subagentWait,
  subagentStop,
  subagentDelete,
  subagentList,
  subagentTail,
});

export type AgentRouter = typeof agentRouter;
