import type { RouterState } from './types.js';
import { RequestStore } from '../request-store.js';

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

    req.state = 'Approved';
    await store.save(req);

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
    await store.save(req);

    return { ...state, reply: `Request ${id} rejected. Reason: ${reason}`, action: 'stop' };
  }

  return state;
}
