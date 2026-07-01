import { randomUUID } from 'node:crypto';
import type { RouterState } from './types.js';
import { delegationManager } from '../delegation-manager.js';
import { readChatSettings, readPoliciesForPath, getWorkspaceRoot } from '../../shared/workspace.js';
import { resolveAgentDir } from '../api/router-utils.js';
import { resolveRequestCwd, truncateLargeOutput } from '../policy-utils.js';
import { executePolicyDelegation } from '../policy-request-service.js';
import { executeSubagent } from '../api/subagent-utils.js';
import { appendMessage } from '../chats.js';
import type { SystemMessage } from '../../shared/chats.js';
import type { Delegation, PolicyDelegation, SubagentDelegation } from '../../shared/delegations.js';
import { executeDirectMessage } from '../message.js';

// Resolve which session the approval/rejection should be replayed on. The
// request may have been created in an earlier session (session-timeout, /new),
// so we always consult the chat's *current* session for that agent/subagent.
async function resolveTargetSessionId(chatId: string, delegation: Delegation): Promise<string> {
  if (delegation.parentId) {
    // Look up the parent subagent's session via the delegation graph rather
    // than the legacy `ChatSettings.subagents` map (Ticket 3).
    const parent = await delegationManager.get(delegation.parentId, chatId);
    if (parent && parent.kind === 'subagent') {
      return parent.sessionId;
    }
    return 'default';
  }
  const chatSettings = await readChatSettings(chatId);
  return chatSettings?.sessions?.[delegation.agentId] ?? 'default';
}

async function loadAndValidateDelegation(id: string, state: RouterState) {
  const record = await delegationManager.get(id, state.chatId);
  if (!record) {
    return { error: { ...state, message: '', reply: `Request not found: ${id}` } };
  }
  // Cross-chat guard is implicit (we loaded via state.chatId), but mirror the
  // legacy error text so existing tests/observability stay stable.
  if (record.chatId !== state.chatId) {
    return {
      error: {
        ...state,
        message: '',
        reply: `Request belongs to a different chat: ${record.chatId}`,
      },
    };
  }
  if (record.state !== 'pending') {
    return { error: { ...state, message: '', reply: `Request is not pending: ${id}` } };
  }
  return { delegation: record };
}

export async function slashPolicies(state: RouterState): Promise<RouterState> {
  const message = state.message.trim();

  if (message === '/pending') {
    const pending = await delegationManager.list({
      chatId: state.chatId,
      kind: 'policy',
      state: 'pending',
    });

    let reply = `Pending Requests (${pending.length}):\n`;
    for (const req of pending) {
      if (req.kind !== 'policy') continue;
      reply += `- ID: ${req.id} | Command: ${req.commandName} ${req.args.join(' ')}\n`;
    }

    return {
      ...state,
      reply,
      action: 'stop',
    };
  }

  const approveMatch = message.match(/^\/approve\s+([^\s]+)/);
  if (approveMatch) {
    const id = approveMatch[1];
    if (!id) return state;
    const { delegation, error } = await loadAndValidateDelegation(id, state);
    if (error) return error;
    if (!delegation) return state; // Should not happen if error is undefined
    if (delegation.kind === 'subagent') {
      return await handleSubagentApprove(state, delegation, id);
    }
    return await handlePolicyApprove(state, delegation, id);
  }

  const rejectMatch = message.match(/^\/reject\s+([^\s]+)(?:\s+(.*))?/);
  if (rejectMatch) {
    const id = rejectMatch[1];
    if (!id) return state;
    const reason = rejectMatch[2] || 'No reason provided';
    const { delegation, error } = await loadAndValidateDelegation(id, state);
    if (error) return error;
    if (!delegation) return state; // Should not happen if error is undefined
    if (delegation.kind === 'subagent') {
      return await handleSubagentReject(state, delegation, id, reason);
    }
    return await handlePolicyReject(state, delegation, id, reason);
  }

  return state;
}

async function handlePolicyApprove(
  state: RouterState,
  delegation: PolicyDelegation,
  id: string
): Promise<RouterState> {
  const workspaceRoot = getWorkspaceRoot();
  const agentDir = await resolveAgentDir(delegation.agentId, workspaceRoot);
  const config = await readPoliciesForPath(agentDir, workspaceRoot);
  const policy = config?.policies?.[delegation.commandName];
  if (!policy) {
    return { ...state, message: '', reply: `Policy not found: ${delegation.commandName}` };
  }

  // pending → running
  await delegationManager.approve(delegation.id, 'user');

  const hostCwd = await resolveRequestCwd(delegation.cwd, state.agentId, workspaceRoot);

  const result = await executePolicyDelegation(delegation, policy, hostCwd);
  const { exitCode } = result;
  const { stdout, stderr } = await truncateLargeOutput(
    result.stdout,
    result.stderr,
    delegation.id,
    state.agentId
  );

  const { wasCovered } = await delegationManager.markResolved(delegation.id, {
    state: 'completed',
    executionResult: { stdout, stderr, exitCode },
  });

  const agentMessage = `Request ${id} approved.\n\n${wrapInHtml('stdout', stdout)}\n\n${wrapInHtml('stderr', stderr)}\n\nExit Code: ${exitCode}`;

  const targetSessionId = await resolveTargetSessionId(state.chatId, delegation);

  const userNotificationMsg: SystemMessage = {
    id: randomUUID(),
    messageId: state.messageId,
    role: 'system',
    event: 'policy_approved',
    displayRole: 'agent',
    content: `Request ${id} (\`${delegation.commandName}\`) approved.`,
    timestamp: new Date().toISOString(),
    // Explicitly omitted subagentId to show in main chat
    sessionId: state.sessionId,
  };

  await appendMessage(state.chatId, userNotificationMsg);

  // Suppression (spec §5.2): when an observer (subscription / sync waiter)
  // is watching this id, the manager owns the wakeup. Skip kicking the
  // fresh "policy-approved" turn so we don't double-fire.
  if (!wasCovered && delegation.delivery === 'notify') {
    await executeDirectMessage(
      state.chatId,
      {
        messageId: randomUUID(),
        message: agentMessage,
        chatId: state.chatId,
        agentId: delegation.agentId,
        sessionId: targetSessionId,
        ...(delegation.parentId ? { subagentId: delegation.parentId } : {}),
        env: state.env || {},
        ...(state.externalRef ? { externalRef: state.externalRef } : {}),
      },
      undefined,
      workspaceRoot,
      true, // noWait
      agentMessage,
      delegation.parentId,
      'policy_approved',
      'user'
    );
  }

  return {
    ...state,
    message: '',
  };
}

async function handlePolicyReject(
  state: RouterState,
  delegation: PolicyDelegation,
  id: string,
  reason: string
): Promise<RouterState> {
  await delegationManager.reject(delegation.id, reason);

  const agentMessage = `Request ${id} rejected. Reason: ${reason}`;

  const targetSessionId = await resolveTargetSessionId(state.chatId, delegation);

  const userNotificationMsg: SystemMessage = {
    id: randomUUID(),
    messageId: state.messageId,
    role: 'system',
    event: 'policy_rejected',
    displayRole: 'agent',
    content: `Request ${id} (\`${delegation.commandName}\`) rejected. Reason: ${reason}`,
    timestamp: new Date().toISOString(),
    sessionId: state.sessionId,
  };

  await appendMessage(state.chatId, userNotificationMsg);

  await executeDirectMessage(
    state.chatId,
    {
      messageId: randomUUID(),
      message: agentMessage,
      chatId: state.chatId,
      agentId: delegation.agentId,
      sessionId: targetSessionId,
      ...(delegation.parentId ? { subagentId: delegation.parentId } : {}),
      env: state.env || {},
      ...(state.externalRef ? { externalRef: state.externalRef } : {}),
    },
    undefined,
    getWorkspaceRoot(),
    true,
    agentMessage,
    delegation.parentId,
    'policy_rejected',
    'user'
  );

  return {
    ...state,
    message: '',
  };
}

// /approve <id> for a subagent delegation: pending → running, then hand off
// to executeSubagent with the saved targetAgentId / sessionId / prompt. We
// reconstruct a token-payload-shaped object from the delegation record so
// the executeSubagent notification routing still threads back to the
// spawner (parent agent / parent subagentId).
async function handleSubagentApprove(
  state: RouterState,
  delegation: SubagentDelegation,
  _id: string
): Promise<RouterState> {
  await delegationManager.approve(delegation.id, 'user');

  const workspaceRoot = getWorkspaceRoot();
  // Parent session = the session of the spawner (so the completion
  // <notification> lands where the user expects). For a subagent-spawned
  // child this is the parent subagent's own session.
  const parentSessionId = await resolveTargetSessionId(state.chatId, delegation);
  const parentTokenPayload = {
    agentId: delegation.agentId,
    ...(delegation.parentId ? { subagentId: delegation.parentId } : {}),
    sessionId: parentSessionId,
  };
  const isAsync = delegation.delivery === 'notify';

  // Fire-and-forget: the subagent runs asynchronously. The slash handler
  // returns immediately so the user-visible /approve turn isn't blocked by
  // a long-running child. Mirrors today's `subagentSpawn` hand-off pattern.
  void executeSubagent(
    state.chatId,
    delegation.id,
    delegation.targetAgentId,
    delegation.sessionId,
    delegation.prompt,
    isAsync,
    parentTokenPayload,
    workspaceRoot
  );

  return {
    ...state,
    message: '',
    reply: `Subagent ${delegation.id} approved.`,
  };
}

async function handleSubagentReject(
  state: RouterState,
  delegation: SubagentDelegation,
  _id: string,
  reason: string
): Promise<RouterState> {
  await delegationManager.reject(delegation.id, reason);
  return {
    ...state,
    message: '',
    reply: `Subagent ${delegation.id} rejected. Reason: ${reason}`,
  };
}

function wrapInHtml(tag: string, text: string): string {
  if (text.trim().length === 0) {
    return `<${tag}></${tag}>`;
  }
  return `<${tag}>\n${text.trim()}\n</${tag}>`;
}
