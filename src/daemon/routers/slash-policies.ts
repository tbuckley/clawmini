import { randomUUID } from 'node:crypto';
import type { RouterState } from './types.js';
import { delegationManager } from '../delegation-manager.js';
import { readChatSettings, readPoliciesForPath, getWorkspaceRoot } from '../../shared/workspace.js';
import { resolveAgentDir } from '../api/router-utils.js';
import { resolveRequestCwd, truncateLargeOutput } from '../policy-utils.js';
import { executePolicyDelegation } from '../policy-request-service.js';
import { appendMessage } from '../chats.js';
import type { SystemMessage } from '../../shared/chats.js';
import type { PolicyDelegation } from '../../shared/delegations.js';
import { executeDirectMessage } from '../message.js';

// Resolve which session the approval/rejection should be replayed on. The
// request may have been created in an earlier session (session-timeout, /new),
// so we always consult the chat's *current* session for that agent/subagent.
async function resolveTargetSessionId(
  chatId: string,
  delegation: PolicyDelegation
): Promise<string> {
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

async function loadAndValidatePolicyDelegation(id: string, state: RouterState) {
  const record = await delegationManager.get(id, state.chatId);
  if (!record || record.kind !== 'policy') {
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
    const { delegation, error } = await loadAndValidatePolicyDelegation(id, state);
    if (error) return error;
    if (!delegation) return state; // Should not happen if error is undefined

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

    await delegationManager.markResolved(delegation.id, {
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
        // Forward externalRef so the resulting `policy_approved` turn anchors
        // its activity log on the same inbound (e.g. the Discord policy card)
        // that drove the /approve. Otherwise emitTurnStarted fires with no
        // anchor and the adapter has nothing to thread on.
        ...(state.externalRef ? { externalRef: state.externalRef } : {}),
      },
      undefined,
      getWorkspaceRoot(),
      true, // noWait
      agentMessage,
      delegation.parentId,
      'policy_approved',
      'user'
    );

    return {
      ...state,
      message: '', // Prevents further router processing or duplicate user message logs
    };
  }

  const rejectMatch = message.match(/^\/reject\s+([^\s]+)(?:\s+(.*))?/);
  if (rejectMatch) {
    const id = rejectMatch[1];
    if (!id) return state;
    const reason = rejectMatch[2] || 'No reason provided';
    const { delegation, error } = await loadAndValidatePolicyDelegation(id, state);
    if (error) return error;
    if (!delegation) return state; // Should not happen if error is undefined

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
      // Explicitly omitted subagentId to show in main chat
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
      true, // noWait
      agentMessage,
      delegation.parentId,
      'policy_rejected',
      'user'
    );

    return {
      ...state,
      message: '', // Prevents further router processing or duplicate user message logs
    };
  }

  return state;
}

function wrapInHtml(tag: string, text: string): string {
  if (text.trim().length === 0) {
    return `<${tag}></${tag}>`;
  }
  return `<${tag}>\n${text.trim()}\n</${tag}>`;
}
