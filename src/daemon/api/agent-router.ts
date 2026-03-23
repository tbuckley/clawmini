import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { TRPCError } from '@trpc/server';
import { appendMessage, type CommandLogMessage } from '../chats.js';
import { executeSafe, generateRequestPreview, executeRequest } from '../policy-utils.js';
import {
  getWorkspaceRoot,
  readPolicies,
  getClawminiDir,
  resolveAgentWorkDir,
  getAgent,
} from '../../shared/workspace.js';
import { PolicyRequestService } from '../policy-request-service.js';
import { RequestStore } from '../request-store.js';
import { CronJobSchema } from '../../shared/config.js';
import { apiProcedure, router } from './trpc.js';
import { getMessageQueue } from '../queue.js';
import { formatPendingMessages } from '../message.js';
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
      role: 'log',
      source: 'router',
      content: messageStr,
      stderr: '',
      timestamp,
      command: `clawmini-lite log${filesArgStr}`,
      cwd: process.cwd(),
      exitCode: 0,
      ...(filePaths.length > 0 ? { files: filePaths } : {}),
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

export const listPolicies = apiProcedure.query(async () => {
  return await readPolicies();
});

export const executePolicyHelp = apiProcedure
  .input(z.object({ commandName: z.string() }))
  .query(async ({ input }) => {
    const config = await readPolicies();
    const policy = config?.policies?.[input.commandName];

    if (!policy) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: `Policy not found: ${input.commandName}`,
      });
    }

    if (!policy.allowHelp) {
      return { stdout: '', stderr: 'This command does not support --help\n', exitCode: 1 };
    }

    const fullArgs = [...(policy.args || []), '--help'];
    const { stdout, stderr, exitCode } = await executeSafe(policy.command, fullArgs, {
      cwd: getWorkspaceRoot(),
    });

    return { stdout, stderr, exitCode };
  });

export const createPolicyRequest = apiProcedure
  .input(
    z.object({
      commandName: z.string(),
      args: z.array(z.string()),
      fileMappings: z.record(z.string(), z.string()),
    })
  )
  .mutation(async ({ input, ctx }) => {
    if (!ctx.tokenPayload) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Missing token' });
    const workspaceRoot = getWorkspaceRoot(process.cwd());
    const snapshotDir = path.join(getClawminiDir(process.cwd()), 'tmp', 'snapshots');
    const store = new RequestStore(process.cwd());
    const agentDir = await resolveAgentDir(ctx.tokenPayload?.agentId, workspaceRoot);
    const service = new PolicyRequestService(store, agentDir, snapshotDir);

    const chatId = ctx.tokenPayload.chatId;
    const agentId = ctx.tokenPayload.agentId;

    const config = await readPolicies();
    const policy = config?.policies?.[input.commandName];

    if (!policy) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: `Policy not found: ${input.commandName}`,
      });
    }

    const isAutoApprove = !!policy.autoApprove;

    const request = await service.createRequest(
      input.commandName,
      input.args,
      input.fileMappings,
      chatId,
      agentId,
      isAutoApprove
    );

    if (isAutoApprove) {
      const { stdout, stderr, exitCode, commandStr } = await executeRequest(
        request,
        policy,
        getWorkspaceRoot()
      );

      request.executionResult = { stdout, stderr, exitCode };
      await store.save(request);

      const logMsg = {
        id: randomUUID(),
        // TODO: we should store the message ID in the CLAW_API_TOKEN, and extract it here
        messageId: randomUUID(),
        role: 'log' as const,
        source: 'router' as const,
        content: `[Auto-approved] Policy ${input.commandName} was executed.`,
        stderr,
        stdout, // Adding stdout and stderr for execution context
        timestamp: new Date().toISOString(),
        command: commandStr,
        cwd: getWorkspaceRoot(),
        exitCode,
      };

      await appendMessage(chatId, logMsg);
      return request;
    }

    const previewContent = await generateRequestPreview(request);

    const logMsg = {
      id: randomUUID(),
      // TODO: we should store the message ID in the CLAW_API_TOKEN, and extract it here
      messageId: randomUUID(),
      role: 'log' as const,
      source: 'router' as const,
      content: previewContent,
      stderr: '',
      timestamp: new Date().toISOString(),
      command: 'policy-request',
      cwd: process.cwd(),
      exitCode: 0,
    };

    await appendMessage(chatId, logMsg);
    return request;
  });

import { ping } from './user-router.js';

export const fetchPendingMessages = apiProcedure.mutation(async ({ ctx }) => {
  if (!ctx.tokenPayload?.agentId) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Missing agent ID' });
  }
  const agentSettings = await getAgent(ctx.tokenPayload?.agentId);
  const agentDir = resolveAgentWorkDir(ctx.tokenPayload?.agentId, agentSettings?.directory);
  const queue = getMessageQueue(agentDir);
  const targetSessionId = ctx.tokenPayload?.sessionId || 'default';

  const extracted = queue.extractPending((p) => p.sessionId === targetSessionId);
  if (extracted.length === 0) {
    return { messages: '' };
  }
  return { messages: formatPendingMessages(extracted.map((p) => p.text)) };
});

export const agentRouter = router({
  logMessage,
  listCronJobs: agentListCronJobs,
  addCronJob: agentAddCronJob,
  deleteCronJob: agentDeleteCronJob,
  listPolicies,
  executePolicyHelp,
  createPolicyRequest,
  fetchPendingMessages,
  ping,
});

export type AgentRouter = typeof agentRouter;
