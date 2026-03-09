import { randomUUID } from 'node:crypto';
import type { RouterState } from './types.js';
import { RequestStore } from '../request-store.js';
import { readPolicies } from '../../shared/workspace.js';
import { executeSafe, interpolateArgs } from '../policy-utils.js';
import { appendMessage } from '../chats.js';
import type { CommandLogMessage } from '../../shared/chats.js';

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
    const store = new RequestStore(process.cwd());
    const requests = await store.list();
    const req = requests.find((r) => r.id === id);
    if (!req) return { ...state, reply: `Request not found: ${id}`, action: 'stop' };
    if (req.state !== 'Pending')
      return { ...state, reply: `Request is not pending: ${id}`, action: 'stop' };

    const config = await readPolicies();
    const policy = config?.policies?.[req.commandName];
    if (!policy) {
      return { ...state, reply: `Policy not found: ${req.commandName}`, action: 'stop' };
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
      messageId: randomUUID(),
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

    return { ...state, reply: `Request ${id} approved.`, action: 'stop' };
  }

  const rejectMatch = message.match(/^\/reject\s+([^\s]+)(?:\s+(.*))?/);
  if (rejectMatch) {
    const id = rejectMatch[1];
    const reason = rejectMatch[2] || 'No reason provided';
    const store = new RequestStore(process.cwd());
    const requests = await store.list();
    const req = requests.find((r) => r.id === id);
    if (!req) return { ...state, reply: `Request not found: ${id}`, action: 'stop' };
    if (req.state !== 'Pending')
      return { ...state, reply: `Request is not pending: ${id}`, action: 'stop' };

    req.state = 'Rejected';
    req.rejectionReason = reason;
    await store.save(req);

    const logMsg: CommandLogMessage = {
      id: randomUUID(),
      messageId: randomUUID(),
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

    return { ...state, reply: `Request ${id} rejected. Reason: ${reason}`, action: 'stop' };
  }

  return state;
}
