import { listChats } from '../shared/chats.js';
import { updateChatSettings, getWorkspaceRoot } from '../shared/workspace.js';
import { RequestStore } from './request-store.js';
import { appendMessage } from './chats.js';
import type { PolicyRequestMessage } from './chats.js';
import { randomUUID } from 'node:crypto';

export async function cleanOrphanedSubagents() {
  try {
    const chats = await listChats();
    for (const chatId of chats) {
      await updateChatSettings(chatId, (settings) => {
        if (settings.subagents) {
          for (const subagent of Object.values(settings.subagents)) {
            if (subagent.status === 'active') {
              subagent.status = 'failed';
            }
          }
        }
        return settings;
      });
    }
  } catch (err) {
    console.warn('Failed to clean orphaned subagents:', err);
  }
}

export async function cleanPendingRequests() {
  try {
    const workspaceRoot = getWorkspaceRoot();
    const store = new RequestStore(workspaceRoot);
    const requests = await store.list();

    for (const req of requests) {
      if (req.state === 'Pending') {
        const msg: PolicyRequestMessage = {
          id: randomUUID(),
          messageId: randomUUID(),
          role: 'policy',
          requestId: req.id,
          commandName: req.commandName,
          args: req.args,
          status: 'rejected',
          content: `Daemon restarted before request ${req.id} was approved. Pending request deleted.`,
          timestamp: new Date().toISOString(),
          displayRole: 'agent',
          ...(req.subagentId ? { subagentId: req.subagentId } : {}),
        };

        await appendMessage(req.chatId, { ...msg, role: 'system', event: 'policy_rejected' });
        await store.delete(req.id);
      }
    }
  } catch (err) {
    console.warn('Failed to clean pending policy requests:', err);
  }
}

export async function cancelPendingSubagentRequests(subagentId: string, reason: string) {
  try {
    const workspaceRoot = getWorkspaceRoot();
    const store = new RequestStore(workspaceRoot);
    const requests = await store.list();

    for (const req of requests) {
      if (req.state === 'Pending' && req.subagentId === subagentId) {
        req.state = 'Rejected';
        req.rejectionReason = reason;
        await store.save(req);

        const msg: PolicyRequestMessage = {
          id: randomUUID(),
          messageId: randomUUID(),
          role: 'policy',
          requestId: req.id,
          commandName: req.commandName,
          args: req.args,
          status: 'rejected',
          content: `Request ${req.id} rejected. Reason: ${reason}`,
          timestamp: new Date().toISOString(),
          displayRole: 'agent',
          subagentId,
        };

        await appendMessage(req.chatId, { ...msg, role: 'system', event: 'policy_rejected' });
      }
    }
  } catch (err) {
    console.warn(`Failed to cancel pending requests for subagent ${subagentId}:`, err);
  }
}
