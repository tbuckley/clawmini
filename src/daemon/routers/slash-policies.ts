import { randomUUID } from 'node:crypto';
import type { RouterState } from './types.js';
import { RequestStore } from '../request-store.js';
import { readPolicies, getWorkspaceRoot } from '../../shared/workspace.js';
import { executeRequest, resolveRequestCwd, truncateLargeOutput } from '../policy-utils.js';
import { appendMessage } from '../chats.js';
import type { SystemMessage } from '../../shared/chats.js';
import { executeDirectMessage } from '../message.js';

async function loadAndValidateRequest(id: string, state: RouterState) {
  const store = new RequestStore(getWorkspaceRoot());
  const req = await store.load(id);
  if (!req) return { error: { ...state, message: '', reply: `Request not found: ${id}` } };
  if (req.chatId && req.chatId !== state.chatId)
    return {
      error: { ...state, message: '', reply: `Request belongs to a different chat: ${req.chatId}` },
    };
  if (req.state !== 'Pending')
    return { error: { ...state, message: '', reply: `Request is not pending: ${id}` } };
  return { req, store };
}

export async function slashPolicies(state: RouterState): Promise<RouterState> {
  const message = state.message.trim();

  if (message === '/pending') {
    const store = new RequestStore(getWorkspaceRoot());
    const requests = await store.list();
    const pending = requests.filter((r) => r.state === 'Pending');

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
    const { req, store, error } = await loadAndValidateRequest(id, state);
    if (error) return error;
    if (!req || !store) return state; // Should not happen if error is undefined

    const config = await readPolicies();
    const policy = config?.policies?.[req.commandName];
    if (!policy) {
      return { ...state, message: '', reply: `Policy not found: ${req.commandName}` };
    }

    req.state = 'Approved';

    const workspaceRoot = getWorkspaceRoot();
    const hostCwd = await resolveRequestCwd(req.cwd, state.agentId, workspaceRoot);

    const result = await executeRequest(req, policy, hostCwd);
    const { exitCode } = result;
    const { stdout, stderr } = await truncateLargeOutput(
      result.stdout,
      result.stderr,
      req.id,
      state.agentId
    );

    req.executionResult = { stdout, stderr, exitCode };
    await store.save(req);

    const agentMessage = `Request ${id} approved.\n\n${wrapInHtml('stdout', stdout)}\n\n${wrapInHtml('stderr', stderr)}\n\nExit Code: ${exitCode}`;

    const userNotificationMsg: SystemMessage = {
      id: randomUUID(),
      messageId: state.messageId,
      role: 'system',
      event: 'policy_approved',
      displayRole: 'agent',
      content: `Request ${id} (\`${req.commandName}\`) approved.`,
      timestamp: new Date().toISOString(),
      // Explicitly omitted subagentId to show in main chat
    };

    await appendMessage(state.chatId, userNotificationMsg);

    await executeDirectMessage(
      state.chatId,
      {
        messageId: randomUUID(),
        message: agentMessage,
        chatId: state.chatId,
        agentId: state.agentId || 'default',
        ...(req.subagentId ? { subagentId: req.subagentId } : {}),
        env: state.env || {},
      },
      undefined,
      getWorkspaceRoot(),
      true, // noWait
      agentMessage,
      req.subagentId,
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
    const { req, store, error } = await loadAndValidateRequest(id, state);
    if (error) return error;
    if (!req || !store) return state; // Should not happen if error is undefined

    req.state = 'Rejected';
    req.rejectionReason = reason;
    await store.save(req);

    const agentMessage = `Request ${id} rejected. Reason: ${reason}`;

    const userNotificationMsg: SystemMessage = {
      id: randomUUID(),
      messageId: state.messageId,
      role: 'system',
      event: 'policy_rejected',
      displayRole: 'agent',
      content: `Request ${id} (\`${req.commandName}\`) rejected. Reason: ${reason}`,
      timestamp: new Date().toISOString(),
      // Explicitly omitted subagentId to show in main chat
    };

    await appendMessage(state.chatId, userNotificationMsg);

    await executeDirectMessage(
      state.chatId,
      {
        messageId: randomUUID(),
        message: agentMessage,
        chatId: state.chatId,
        agentId: state.agentId || 'default',
        ...(req.subagentId ? { subagentId: req.subagentId } : {}),
        env: state.env || {},
      },
      undefined,
      getWorkspaceRoot(),
      true, // noWait
      agentMessage,
      req.subagentId,
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
