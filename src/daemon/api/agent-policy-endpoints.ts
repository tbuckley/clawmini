import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { apiProcedure } from './trpc.js';
import { getWorkspaceRoot, readPoliciesForPath, getClawminiDir } from '../../shared/workspace.js';
import { pathIsInsideDir } from '../../shared/utils/fs.js';
import { resolveAgentDir } from './router-utils.js';
import { PolicyRequestService } from '../policy-request-service.js';
import { RequestStore } from '../request-store.js';
import {
  executeSafe,
  generateRequestPreview,
  executeRequest,
  resolveRequestCwd,
  truncateLargeOutput,
} from '../policy-utils.js';
import { appendMessage, type PolicyRequestMessage } from '../chats.js';

const MAX_POLICY_SCRIPT_BYTES = 1 * 1024 * 1024;
// Above this, the script is copied into the agent's tmp/ instead of being
// inlined in the response, so `requests show` does not flood the agent's
// context with a long script body. Mirrors truncateLargeOutput in policy-utils.
const MAX_INLINE_SCRIPT_LENGTH = 4000;

export const listPolicies = apiProcedure.query(async ({ ctx }) => {
  const workspaceRoot = getWorkspaceRoot();
  const agentDir = await resolveAgentDir(ctx.tokenPayload?.agentId, workspaceRoot);
  const config = await readPoliciesForPath(agentDir, workspaceRoot);
  return { policies: config?.policies || {} };
});

// Returns the contents of a policy's script file. Restricted to scripts inside
// `.clawmini/policy-scripts/` so an arbitrary `command` path (e.g. `/etc/passwd`
// or a built-in node binary) cannot be exfiltrated through this endpoint.
export const readPolicyScript = apiProcedure
  .input(z.object({ commandName: z.string() }))
  .query(async ({ input, ctx }) => {
    const workspaceRoot = getWorkspaceRoot();
    const agentDir = await resolveAgentDir(ctx.tokenPayload?.agentId, workspaceRoot);
    const config = await readPoliciesForPath(agentDir, workspaceRoot);
    const policy = config?.policies?.[input.commandName];

    if (!policy) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: `Policy not found: ${input.commandName}`,
      });
    }

    const scriptsDir = path.join(getClawminiDir(), 'policy-scripts');
    const resolvedCommand = path.resolve(policy.command);

    if (!pathIsInsideDir(resolvedCommand, scriptsDir, { allowSameDir: false })) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Policy '${input.commandName}' does not point at a script in policy-scripts/.`,
      });
    }

    // realpath resolves symlinks in both paths; without this, a symlink inside
    // policy-scripts/ pointing at /etc/passwd would pass the string-prefix
    // check above, then fs.stat/readFile would dereference and exfiltrate.
    let realCommand: string;
    let realScriptsDir: string;
    try {
      realCommand = await fs.realpath(resolvedCommand);
    } catch (err) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: `Script file not found for policy '${input.commandName}': ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
    }
    try {
      realScriptsDir = await fs.realpath(scriptsDir);
    } catch {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Policy '${input.commandName}' does not point at a script in policy-scripts/.`,
      });
    }
    if (!pathIsInsideDir(realCommand, realScriptsDir, { allowSameDir: false })) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Policy '${input.commandName}' does not point at a script in policy-scripts/.`,
      });
    }

    let stat;
    try {
      stat = await fs.stat(realCommand);
    } catch (err) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: `Script file not found for policy '${input.commandName}': ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
    }

    if (!stat.isFile()) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Script path for policy '${input.commandName}' is not a regular file.`,
      });
    }

    if (stat.size > MAX_POLICY_SCRIPT_BYTES) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Script file exceeds the ${MAX_POLICY_SCRIPT_BYTES}-byte limit.`,
      });
    }

    if (stat.size > MAX_INLINE_SCRIPT_LENGTH) {
      const tmpDir = path.join(agentDir, 'tmp');
      await fs.mkdir(tmpDir, { recursive: true });
      const ext = path.extname(realCommand);
      const safeName = input.commandName.replace(/[^a-zA-Z0-9._-]/g, '_');
      const destPath = path.join(tmpDir, `policy-script-${safeName}${ext}`);
      await fs.copyFile(realCommand, destPath);
      return {
        path: realCommand,
        size: stat.size,
        spilledTo: `./tmp/policy-script-${safeName}${ext}`,
      };
    }

    const content = await fs.readFile(realCommand, 'utf8');
    return { path: realCommand, size: stat.size, content };
  });

export const executePolicyHelp = apiProcedure
  .input(z.object({ commandName: z.string() }))
  .query(async ({ input, ctx }) => {
    const workspaceRoot = getWorkspaceRoot();
    const agentDir = await resolveAgentDir(ctx.tokenPayload?.agentId, workspaceRoot);
    const config = await readPoliciesForPath(agentDir, workspaceRoot);
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
      // Path traversal is guarded by assertPathInsideDir in resolveRequestCwd
      // (policy-utils.ts), which realpath-resolves the cwd before comparing —
      // so it covers encoded separators, symlinks, etc.
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

    const config = await readPoliciesForPath(agentDir, workspaceRoot);
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

      const result = await executeRequest(request, policy, hostCwd);
      const { exitCode, commandStr } = result;
      const { stdout, stderr } = await truncateLargeOutput(
        result.stdout,
        result.stderr,
        request.id,
        agentId
      );

      request.executionResult = { stdout, stderr, exitCode };

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
        sessionId: ctx.tokenPayload.sessionId,
        ...(ctx.tokenPayload.subagentId ? { subagentId: ctx.tokenPayload.subagentId } : {}),
        ...(ctx.tokenPayload.turnId ? { turnId: ctx.tokenPayload.turnId } : {}),
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
      sessionId: ctx.tokenPayload.sessionId,
      ...(ctx.tokenPayload.turnId ? { turnId: ctx.tokenPayload.turnId } : {}),
    };

    await appendMessage(chatId, logMsg);
    return request;
  });
