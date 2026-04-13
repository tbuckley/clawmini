import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { apiProcedure } from './trpc.js';
import { getWorkspaceRoot, readPolicies, getClawminiDir } from '../../shared/workspace.js';
import { resolveAgentDir } from './router-utils.js';
import { PolicyRequestService } from '../policy-request-service.js';
import { RequestStore } from '../request-store.js';
import {
  executeSafe,
  generateRequestPreview,
  executeRequest,
  resolveRequestCwd,
} from '../policy-utils.js';
import { appendMessage, type PolicyRequestMessage } from '../chats.js';

export const listPolicies = apiProcedure.query(async () => {
  const config = await readPolicies();
  return { policies: config?.policies || {} };
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
      // Path traversal is guarded by pathIsInsideDir in translateSandboxPath
      // (policy-utils.ts), which validates the fully-resolved path — not the
      // raw string — so it covers encoded separators, symlinks, etc.
      cwd: z.string().optional(),
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
      ctx.tokenPayload.subagentId,
      input.cwd
    );

    if (isAutoApprove) {
      const hostCwd = await resolveRequestCwd(request.cwd, agentId, workspaceRoot);

      const { stdout, stderr, exitCode, commandStr } = await executeRequest(
        request,
        policy,
        hostCwd
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
