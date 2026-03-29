import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { TRPCError } from '@trpc/server';
import {
  appendMessage,
  type CommandLogMessage,
  type AgentReplyMessage,
  type ToolMessage,
  type PolicyRequestMessage,
} from '../chats.js';
import { executeSafe, generateRequestPreview, executeRequest } from '../policy-utils.js';
import { getWorkspaceRoot, readPolicies, getClawminiDir } from '../../shared/workspace.js';
import { PolicyRequestService } from '../policy-request-service.js';
import { RequestStore } from '../request-store.js';
import { apiProcedure, router } from './trpc.js';
import { taskScheduler } from '../agent/task-scheduler.js';
import { formatPendingMessages } from '../agent/utils.js';
import { resolveAgentDir, validateLogFile } from './router-utils.js';

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

import { agentListCronJobs, agentAddCronJob, agentDeleteCronJob } from './cron-router.js';

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

    if (!policy.command) {
      if (input.commandName.startsWith('@clawmini/')) {
        return { stdout: '', stderr: 'This pseudo-command does not support --help\n', exitCode: 1 };
      }
      return {
        stdout: '',
        stderr: `Policy ${input.commandName} is missing a required 'command' field.\n`,
        exitCode: 1,
      };
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
      isAutoApprove,
      ctx.tokenPayload.subagentId
    );

    if (isAutoApprove) {
      const { stdout, stderr, exitCode, commandStr } = await executeRequest(
        request,
        policy,
        getWorkspaceRoot()
      );

      request.executionResult = { stdout, stderr, exitCode };
      await store.save(request);

      const logMsg: PolicyRequestMessage = {
        id: randomUUID(),
        // TODO: we should store the message ID in the CLAW_API_TOKEN, and extract it here
        messageId: randomUUID(),
        role: 'policy',
        requestId: request.id,
        commandName: input.commandName,
        args: input.args,
        status: 'approved',
        content: `[Auto-approved] Policy ${input.commandName} was executed.\n\nCommand: ${commandStr}\nExit Code: ${exitCode}\n\nStdout:\n${stdout}\n\nStderr:\n${stderr}`,
        timestamp: new Date().toISOString(),
        ...(ctx.tokenPayload.subagentId ? { subagentId: ctx.tokenPayload.subagentId } : {}),
      };

      await appendMessage(chatId, logMsg);
      return request;
    }

    const previewContent = await generateRequestPreview(request);

    const logMsg: PolicyRequestMessage = {
      id: randomUUID(),
      // TODO: we should store the message ID in the CLAW_API_TOKEN, and extract it here
      messageId: randomUUID(),
      role: 'policy',
      requestId: request.id,
      commandName: input.commandName,
      args: input.args,
      status: 'pending',
      content: previewContent,
      timestamp: new Date().toISOString(),
      displayRole: 'agent',
    };

    await appendMessage(chatId, logMsg);
    return request;
  });

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
