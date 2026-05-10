import { randomUUID } from 'node:crypto';
import type { RouterState } from './types.js';
import { DelegationStore } from '../delegation-store.js';
import { DelegationManager } from '../delegation-manager.js';
import { readChatSettings, readPoliciesForPath, getWorkspaceRoot } from '../../shared/workspace.js';
import { resolveAgentDir } from '../api/router-utils.js';
import { executeRequest, resolveRequestCwd, truncateLargeOutput } from '../policy-utils.js';
import { appendMessage } from '../chats.js';
import type { SystemMessage } from '../../shared/chats.js';
import type { PolicyDelegation, Delegation } from '../../shared/delegations.js';
import { executeDirectMessage } from '../message.js';

// Resolve which session the approval/rejection should be replayed on. The
// request may have been created in an earlier session (session-timeout, /new),
// so we always consult the chat's *current* session for that agent/subagent.
async function resolveTargetSessionId(chatId: string, req: Delegation): Promise<string> {
  const chatSettings = await readChatSettings(chatId);
  if (req.parentId) {
    return chatSettings?.subagents?.[req.parentId]?.sessionId ?? 'default';
  }
  return chatSettings?.sessions?.[req.agentId] ?? 'default';
}

async function loadAndValidateRequest(id: string, state: RouterState) {
  const store = new DelegationStore();
  const manager = new DelegationManager(store);
  const req = await manager.get(state.chatId, id);
  if (!req) return { error: { ...state, message: '', reply: `Delegation not found: ${id}` } };
  if (req.state !== 'pending')
    return { error: { ...state, message: '', reply: `Delegation is not pending: ${id}` } };
  return { req, manager };
}

export async function slashPolicies(state: RouterState): Promise<RouterState> {
  const message = state.message.trim();

  if (message === '/pending') {
    const store = new DelegationStore();
    const manager = new DelegationManager(store);
    const requests = await manager.list(state.chatId);
    const pending = requests.filter(
      (r) => r.state === 'pending' && r.kind === 'policy'
    ) as PolicyDelegation[];

    let reply = `Pending Requests (${pending.length}):\n`;
    for (const req of pending) {
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
    const { req, manager, error } = await loadAndValidateRequest(id, state);
    if (error) return error;
    if (!req || !manager) return state;

    await manager.approve(state.chatId, req.id);

    let agentMessage = '';
    let userNotificationContent = '';

    if (req.kind === 'policy') {
      const workspaceRoot = getWorkspaceRoot();
      const agentDir = await resolveAgentDir(req.agentId, workspaceRoot);
      const config = await readPoliciesForPath(agentDir, workspaceRoot);
      const policy = config?.policies?.[req.commandName];
      if (!policy) {
        return { ...state, message: '', reply: `Policy not found: ${req.commandName}` };
      }

      const hostCwd = await resolveRequestCwd(req.cwd, state.agentId, workspaceRoot);

      const result = await executeRequest(req, policy, hostCwd);
      const { exitCode } = result;
      const { stdout, stderr } = await truncateLargeOutput(
        result.stdout,
        result.stderr,
        req.id,
        state.agentId
      );

      await manager.markResolved(state.chatId, req.id, exitCode === 0 ? 'completed' : 'failed', {
        stdout,
        stderr,
        exitCode,
      });

      agentMessage = `Request ${id} approved.\n\n${wrapInHtml('stdout', stdout)}\n\n${wrapInHtml('stderr', stderr)}\n\nExit Code: ${exitCode}`;
      userNotificationContent = `Request ${id} (\`${req.commandName}\`) approved.`;
    } else if (req.kind === 'subagent') {
      // Subagent dispatch will be fully wired up in the subagent ticket,
      // but we satisfy the "per-kind dispatch" stub here.
      // For now, just mark it running, the subagent router or manager will handle the rest.
      agentMessage = `Subagent delegation ${id} approved.`;
      userNotificationContent = `Subagent delegation ${id} approved.`;
    }

    const targetSessionId = await resolveTargetSessionId(state.chatId, req);

    const userNotificationMsg: SystemMessage = {
      id: randomUUID(),
      messageId: state.messageId,
      role: 'system',
      event: 'policy_approved',
      displayRole: 'agent',
      content: userNotificationContent,
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
        agentId: req.agentId,
        sessionId: targetSessionId,
        ...(req.parentId ? { subagentId: req.parentId } : {}),
        env: state.env || {},
        ...(state.externalRef ? { externalRef: state.externalRef } : {}),
      },
      undefined,
      getWorkspaceRoot(),
      true, // noWait
      agentMessage,
      req.parentId,
      'policy_approved',
      'user'
    );

    return {
      ...state,
      message: '',
    };
  }

  const rejectMatch = message.match(/^\/reject\s+([^\s]+)(?:\s+(.*))?/);
  if (rejectMatch) {
    const id = rejectMatch[1];
    if (!id) return state;
    const reason = rejectMatch[2] || 'No reason provided';
    const { req, manager, error } = await loadAndValidateRequest(id, state);
    if (error) return error;
    if (!req || !manager) return state;

    await manager.reject(state.chatId, req.id, reason);

    const isPolicy = req.kind === 'policy';
    const displayCommandName = isPolicy ? (req as PolicyDelegation).commandName : 'subagent';

    const agentMessage = `Request ${id} rejected. Reason: ${reason}`;

    const targetSessionId = await resolveTargetSessionId(state.chatId, req);

    const userNotificationMsg: SystemMessage = {
      id: randomUUID(),
      messageId: state.messageId,
      role: 'system',
      event: 'policy_rejected',
      displayRole: 'agent',
      content: `Request ${id} (\`${displayCommandName}\`) rejected. Reason: ${reason}`,
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
        agentId: req.agentId,
        sessionId: targetSessionId,
        ...(req.parentId ? { subagentId: req.parentId } : {}),
        env: state.env || {},
        ...(state.externalRef ? { externalRef: state.externalRef } : {}),
      },
      undefined,
      getWorkspaceRoot(),
      true, // noWait
      agentMessage,
      req.parentId,
      'policy_rejected',
      'user'
    );

    return {
      ...state,
      message: '',
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
