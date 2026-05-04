import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import {
  appendMessage,
  getMessages,
  type ChatMessage,
  type CommandLogMessage,
  type AgentReplyMessage,
  type ToolMessage,
} from '../chats.js';
import { getWorkspaceRoot } from '../../shared/workspace.js';
import type { CronJob } from '../../shared/config.js';
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
      sessionId: ctx.tokenPayload.sessionId,
      ...(ctx.tokenPayload.subagentId ? { subagentId: ctx.tokenPayload.subagentId } : {}),
      ...(ctx.tokenPayload.turnId ? { turnId: ctx.tokenPayload.turnId } : {}),
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
      sessionId: ctx.tokenPayload.sessionId,
      ...(ctx.tokenPayload.subagentId ? { subagentId: ctx.tokenPayload.subagentId } : {}),
      ...(ctx.tokenPayload.turnId ? { turnId: ctx.tokenPayload.turnId } : {}),
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
      sessionId: ctx.tokenPayload.sessionId,
      ...(ctx.tokenPayload.subagentId ? { subagentId: ctx.tokenPayload.subagentId } : {}),
      ...(ctx.tokenPayload.turnId ? { turnId: ctx.tokenPayload.turnId } : {}),
    };

    await appendMessage(chatId, logMsg);
    return { success: true };
  });

export const agentListCronJobs = apiProcedure.query(async ({ ctx }) => {
  if (!ctx.tokenPayload) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Missing token' });
  const chatId = ctx.tokenPayload.chatId;
  return listCronJobsShared(chatId);
});

// Agents may only set a restricted subset of CronJob fields. The remaining
// fields (agentId, createdAt, env, nextSessionId, action, jobs) are reserved
// for internal use and filled in by the server.
export const AgentCronJobInputSchema = z.strictObject({
  id: z.string().min(1),
  message: z.string().default(''),
  reply: z.string().optional(),
  session: z
    .union([
      z.strictObject({ type: z.literal('new') }),
      z.strictObject({ type: z.literal('existing'), id: z.string() }),
    ])
    .optional(),
  schedule: z.union([
    z.strictObject({ cron: z.string() }),
    z.strictObject({ every: z.string() }),
    z.strictObject({ at: z.string() }),
  ]),
});

export type AgentCronJobInput = z.infer<typeof AgentCronJobInputSchema>;

export const agentAddCronJob = apiProcedure
  .input(z.object({ job: AgentCronJobInputSchema }))
  .mutation(async ({ input, ctx }) => {
    if (!ctx.tokenPayload) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Missing token' });
    const chatId = ctx.tokenPayload.chatId;
    const job: CronJob = {
      id: input.job.id,
      message: input.job.message,
      schedule: input.job.schedule,
      createdAt: new Date().toISOString(),
      agentId: ctx.tokenPayload.agentId,
      ...(input.job.reply !== undefined ? { reply: input.job.reply } : {}),
      ...(input.job.session !== undefined ? { session: input.job.session } : {}),
    };
    return addCronJobShared(chatId, job);
  });

export const agentDeleteCronJob = apiProcedure
  .input(z.object({ id: z.string() }))
  .mutation(async ({ input, ctx }) => {
    if (!ctx.tokenPayload) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Missing token' });
    const chatId = ctx.tokenPayload.chatId;
    return deleteCronJobShared(chatId, input.id);
  });

import {
  listPolicies,
  executePolicyHelp,
  createPolicyRequest,
  readPolicyScript,
} from './agent-policy-endpoints.js';

import { ping } from './user-router.js';

// Predicate: a message is part of the agent-facing thread when (1) it has no
// subagentId, (2) it does not have displayRole === 'agent' (router auto-replies
// opt out via that flag), and (3) it is either a real user message, a
// displayRole === 'user' adapter echo, or a real agent reply. See SPEC.md
// "What counts as the conversation as the agent should see it".
function isAgentVisibleMessage(msg: ChatMessage): boolean {
  if (msg.subagentId !== undefined) return false;
  if (msg.displayRole === 'agent') return false;
  if (msg.displayRole === 'user') return true;
  if (msg.role === 'user') return true;
  if (msg.role === 'agent') return true;
  return false;
}

interface ThreadHistoryEntry {
  id: string;
  role: 'user' | 'agent';
  content: string;
  timestamp: string;
  files?: string[];
  sessionId?: string;
}

function normalizeThreadEntry(msg: ChatMessage): ThreadHistoryEntry {
  const role: 'user' | 'agent' =
    msg.displayRole === 'user' ? 'user' : msg.role === 'user' ? 'user' : 'agent';
  const entry: ThreadHistoryEntry = {
    id: msg.id,
    role,
    content: msg.content,
    timestamp: msg.timestamp,
  };
  const files = (msg as { files?: string[] }).files;
  if (Array.isArray(files) && files.length > 0) entry.files = files;
  if (msg.sessionId !== undefined) entry.sessionId = msg.sessionId;
  return entry;
}

export const getThreadHistory = apiProcedure
  .input(
    z.object({
      limit: z.number().int().min(1).max(200).optional(),
      before: z.string().optional(),
    })
  )
  .query(async ({ input, ctx }) => {
    if (!ctx.tokenPayload) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Missing token' });
    }
    if (ctx.tokenPayload.subagentId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'thread history is not available to subagents',
      });
    }

    const chatId = ctx.tokenPayload.chatId;
    const limit = input.limit ?? 20;

    const fetched = await getMessages(
      chatId,
      limit + 1,
      process.cwd(),
      isAgentVisibleMessage,
      input.before
    );

    let hasMore = false;
    let page = fetched;
    if (fetched.length > limit) {
      hasMore = true;
      page = fetched.slice(1);
    }

    const messages = page.map(normalizeThreadEntry);
    const oldestId = messages.length > 0 ? messages[0]!.id : undefined;
    return { messages, hasMore, oldestId };
  });

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
  readPolicyScript,
  fetchPendingMessages,
  getThreadHistory,
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
