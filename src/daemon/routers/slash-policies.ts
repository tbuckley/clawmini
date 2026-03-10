import { randomUUID } from 'node:crypto';
import type { RouterState } from './types.js';
import { RequestStore } from '../request-store.js';
import { readPolicies } from '../../shared/workspace.js';
import { executeSafe, interpolateArgs } from '../policy-utils.js';
import { appendMessage } from '../chats.js';
import type { CommandLogMessage } from '../../shared/chats.js';

async function loadAndValidateRequest(id: string, state: RouterState) {
  const store = new RequestStore(process.cwd());
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
    const store = new RequestStore(process.cwd());
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
    await store.save(req);

    const fullArgs = [...(policy.args || []), ...req.args];
    const interpolatedArgs = interpolateArgs(fullArgs, req.fileMappings);

    const { stdout, stderr, exitCode } = await executeSafe(policy.command, interpolatedArgs, {
      cwd: process.cwd(),
    });

    const commandStr = `${policy.command} ${interpolatedArgs.join(' ')}`;
    const logMsg: CommandLogMessage = {
      id: randomUUID(),
      messageId: state.messageId,
      role: 'log',
      source: 'router',
      content: `Request ${id} approved and executed.`,
      stderr,
      stdout,
      timestamp: new Date().toISOString(),
      command: commandStr,
      cwd: process.cwd(),
      exitCode,
    };

    await appendMessage(state.chatId, logMsg);

    const agentMessage = `Request ${id} approved.\n\nSTDOUT:\n${stdout}\n\nSTDERR:\n${stderr}\n\nExit Code: ${exitCode}`;
    return { ...state, message: agentMessage };
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

    const logMsg: CommandLogMessage = {
      id: randomUUID(),
      messageId: state.messageId,
      role: 'log',
      source: 'router',
      content: `Request ${id} rejected. Reason: ${reason}`,
      stderr: '',
      timestamp: new Date().toISOString(),
      command: `policy-request-reject ${id}`,
      cwd: process.cwd(),
      exitCode: 1,
    };

    await appendMessage(state.chatId, logMsg);

    const agentMessage = `Request ${id} rejected. Reason: ${reason}`;
    return { ...state, message: agentMessage };
  }

  return state;
}
