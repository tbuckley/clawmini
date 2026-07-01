import { randomUUID } from 'node:crypto';
import { getAgentPath, readPoliciesForPath } from '../../shared/workspace.js';
import { resolveSubagentApproval } from '../../shared/approvals.js';
import { resolveAgentDir } from './router-utils.js';
import { appendMessage } from '../chats.js';
import type { SubagentApprovalMessage } from '../../shared/chats.js';

// Approval-gating helpers used by `subagentSpawn` / `subagentSend`. Extracted
// from `subagent-router.ts` so that file stays under the `max-lines: 300`
// ESLint rule. Spec §4.

/**
 * Resolve the subagent approval rules in `policies.json` against the
 * (caller → target) edge. Returns the auto-approve decision plus the agent
 * paths used to make it (so callers can render the preview message without
 * recomputing them). The built-in `$self → $self` tail is appended inside
 * `resolveSubagentApproval`. Spec §4.4.
 */
export async function resolveSubagentEdgeAutoApprove(
  callerAgentId: string,
  targetAgentId: string,
  workspaceRoot: string
): Promise<{ fromPath: string; toPath: string; autoApprove: boolean }> {
  const fromPath = await getAgentPath(callerAgentId, workspaceRoot);
  const toPath = await getAgentPath(targetAgentId, workspaceRoot);
  // The rule list lives in the spawner's `policies.json` (resolved against
  // the spawner's agent dir, same as `createPolicyRequest`).
  const callerDir = await resolveAgentDir(callerAgentId, workspaceRoot);
  const config = await readPoliciesForPath(callerDir, workspaceRoot);
  const userRules = config?.subagents ?? [];
  const autoApprove = resolveSubagentApproval({ fromPath, toPath }, userRules);
  return { fromPath, toPath, autoApprove };
}

/**
 * Append the `/approve <id>` / `/reject <id>` chat preview that mirrors the
 * policy-request preview. Spec §3.4, §7.5 — the message uses `role: 'policy'`
 * with `kind: 'subagent'` so existing chat adapters render it identically to
 * a policy request.
 */
export async function appendSubagentApprovalPreview(
  chatId: string,
  id: string,
  fromAgent: string,
  toAgent: string,
  operation: 'spawn' | 'send',
  prompt: string,
  ctx: {
    sessionId: string | undefined;
    turnId: string | undefined;
    subagentId: string | undefined;
  }
): Promise<void> {
  const content =
    `Subagent ${operation} request: ${fromAgent} → ${toAgent}\n` +
    `ID: ${id}\n` +
    `Prompt:\n${prompt}\n\n` +
    `Use /approve ${id} or /reject ${id} [reason]`;
  const msg: SubagentApprovalMessage = {
    id: randomUUID(),
    messageId: randomUUID(),
    role: 'policy',
    kind: 'subagent',
    requestId: id,
    fromAgent,
    toAgent,
    operation,
    status: 'pending',
    content,
    timestamp: new Date().toISOString(),
    displayRole: 'agent',
    sessionId: ctx.sessionId,
    ...(ctx.turnId ? { turnId: ctx.turnId } : {}),
    ...(ctx.subagentId ? { subagentId: ctx.subagentId } : {}),
  };
  await appendMessage(chatId, msg);
}
