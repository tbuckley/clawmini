import { DelegationStore } from './delegation-store.js';
import type {
  Delegation,
  PolicyDelegation,
  SubagentDelegation,
  DeliveryMode,
} from '../shared/delegations.js';
import crypto from 'node:crypto';
import { on } from 'node:events';
import {
  daemonEvents,
  DAEMON_EVENT_DELEGATION_RESOLVED,
  emitDelegationResolved,
  emitDelegationSubscriptionFired,
} from './events.js';

export interface WaitOptions {
  chatId: string;
  ids: string[];
  mode: 'any' | 'all';
  returnMode: 'sync' | 'subscribe';
  callerSubagentId?: string;
  callerAgentId?: string;
  callerSessionId?: string;
  callerTurnId?: string;
  signal?: AbortSignal;
}

export type WaitResult =
  | { type: 'sync'; resolved: Delegation[] }
  | { type: 'subscription'; subscriptionId: string };

const globalSubscriptions = new Map<string, { options: WaitOptions; resolvedIds: Set<string> }>();

// Register global listener for DAEMON_EVENT_DELEGATION_RESOLVED
daemonEvents.on(DAEMON_EVENT_DELEGATION_RESOLVED, (event) => {
  for (const [subId, sub] of globalSubscriptions.entries()) {
    if (sub.options.chatId !== event.chatId) continue;
    if (!sub.options.ids.includes(event.delegationId)) continue;

    sub.resolvedIds.add(event.delegationId);

    let fired = false;
    if (sub.options.mode === 'any' && sub.resolvedIds.size > 0) {
      fired = true;
    } else if (sub.options.mode === 'all' && sub.resolvedIds.size === sub.options.ids.length) {
      fired = true;
    }

    if (fired) {
      globalSubscriptions.delete(subId);
      emitDelegationSubscriptionFired({
        chatId: event.chatId,
        subscriptionId: subId,
        resolvedIds: Array.from(sub.resolvedIds),
        ...(sub.options.callerAgentId ? { callerAgentId: sub.options.callerAgentId } : {}),
        ...(sub.options.callerSubagentId ? { callerSubagentId: sub.options.callerSubagentId } : {}),
        ...(sub.options.callerSessionId ? { callerSessionId: sub.options.callerSessionId } : {}),
        ...(sub.options.callerTurnId ? { callerTurnId: sub.options.callerTurnId } : {}),
      });
    }
  }
});

export class DelegationManager {
  constructor(private store: DelegationStore) {}

  async createPolicy(options: {
    chatId: string;
    agentId: string;
    parentId?: string;
    commandName: string;
    args: string[];
    fileMappings: Record<string, string>;
    cwd?: string;
    delivery: DeliveryMode;
  }): Promise<PolicyDelegation> {
    const id = await this.store.createUniqueId(options.chatId);
    const delegation: PolicyDelegation = {
      id,
      kind: 'policy',
      state: 'pending',
      delivery: options.delivery,
      chatId: options.chatId,
      agentId: options.agentId,
      ...(options.parentId ? { parentId: options.parentId } : {}),
      createdAt: new Date().toISOString(),
      commandName: options.commandName,
      args: options.args,
      fileMappings: options.fileMappings,
      ...(options.cwd ? { cwd: options.cwd } : {}),
    };
    await this.store.save(delegation);
    return delegation;
  }

  async createSubagent(options: {
    chatId: string;
    agentId: string;
    parentId?: string;
    targetAgentId: string;
    prompt: string;
    delivery: DeliveryMode;
  }): Promise<SubagentDelegation> {
    const id = await this.store.createUniqueId(options.chatId);
    const sessionId = crypto.randomUUID();
    const delegation: SubagentDelegation = {
      id,
      kind: 'subagent',
      state: 'pending', // Awaiting approval gate if applicable, or will transition to running
      delivery: options.delivery,
      chatId: options.chatId,
      agentId: options.agentId,
      ...(options.parentId ? { parentId: options.parentId } : {}),
      createdAt: new Date().toISOString(),
      targetAgentId: options.targetAgentId,
      sessionId,
      prompt: options.prompt,
    };
    await this.store.save(delegation);
    return delegation;
  }

  async sendToSubagent(options: {
    chatId: string;
    id: string;
    prompt: string;
  }): Promise<SubagentDelegation> {
    const delegation = await this.store.load(options.chatId, options.id);
    if (!delegation) {
      throw new Error(`Delegation ${options.id} not found`);
    }
    if (delegation.kind !== 'subagent') {
      throw new Error(`Delegation ${options.id} is not a subagent`);
    }
    delegation.prompt = options.prompt;
    delegation.state = 'running';
    await this.store.save(delegation);
    return delegation;
  }

  async approve(chatId: string, id: string): Promise<Delegation> {
    const delegation = await this.store.load(chatId, id);
    if (!delegation) {
      throw new Error(`Delegation ${id} not found`);
    }
    if (delegation.state !== 'pending') {
      throw new Error(`Delegation ${id} cannot be approved from state ${delegation.state}`);
    }
    delegation.state = 'running';
    await this.store.save(delegation);
    return delegation;
  }

  async reject(chatId: string, id: string, reason?: string): Promise<Delegation> {
    const delegation = await this.store.load(chatId, id);
    if (!delegation) {
      throw new Error(`Delegation ${id} not found`);
    }
    if (delegation.state !== 'pending') {
      throw new Error(`Delegation ${id} cannot be rejected from state ${delegation.state}`);
    }
    delegation.state = 'rejected';
    delegation.resolvedAt = new Date().toISOString();
    if (reason) {
      delegation.rejectionReason = reason;
    }
    await this.store.save(delegation);
    emitDelegationResolved({ chatId, delegationId: id, state: 'rejected' });
    return delegation;
  }

  async markResolved(
    chatId: string,
    id: string,
    state: 'completed' | 'failed',
    executionResult?: { stdout: string; stderr: string; exitCode: number }
  ): Promise<Delegation> {
    const delegation = await this.store.load(chatId, id);
    if (!delegation) {
      throw new Error(`Delegation ${id} not found`);
    }
    delegation.state = state;
    delegation.resolvedAt = new Date().toISOString();

    if (delegation.kind === 'policy' && executionResult) {
      delegation.executionResult = executionResult;
    }

    await this.store.save(delegation);
    emitDelegationResolved({ chatId, delegationId: id, state });
    return delegation;
  }

  async get(chatId: string, id: string): Promise<Delegation | null> {
    return this.store.load(chatId, id);
  }

  async list(chatId: string): Promise<Delegation[]> {
    return this.store.list(chatId);
  }

  async delete(chatId: string, id: string): Promise<void> {
    return this.store.delete(chatId, id);
  }

  async assertVisibleTo(
    chatId: string,
    id: string,
    callerSubagentId: string | undefined
  ): Promise<Delegation> {
    const delegation = await this.get(chatId, id);
    if (!delegation) {
      throw new Error(`Delegation ${id} not found`);
    }
    if (delegation.parentId !== callerSubagentId) {
      throw new Error(`Delegation ${id} is not visible to the caller`);
    }
    return delegation;
  }

  async wait(options: WaitOptions): Promise<WaitResult> {
    for (const id of options.ids) {
      await this.assertVisibleTo(options.chatId, id, options.callerSubagentId);
    }

    // Setup event iterator first to avoid missing events during async state checks
    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), 3600000); // 1 hr max block

    const onAbort = () => {
      clearTimeout(timeout);
      ac.abort();
    };
    if (options.signal) {
      options.signal.addEventListener('abort', onAbort);
    }

    const eventIterator = on(daemonEvents, DAEMON_EVENT_DELEGATION_RESOLVED, {
      signal: ac.signal,
    });

    const resolvedIds = new Set<string>();

    try {
      const allDels: Delegation[] = [];

      for (const id of options.ids) {
        const del = await this.get(options.chatId, id);
        if (del) {
          allDels.push(del);
          if (['completed', 'failed', 'rejected'].includes(del.state)) {
            resolvedIds.add(id);
          }
        }
      }

      const checkCondition = () => {
        if (options.mode === 'any' && resolvedIds.size > 0) return true;
        if (options.mode === 'all' && resolvedIds.size === options.ids.length) return true;
        return false;
      };

      if (checkCondition()) {
        clearTimeout(timeout);
        if (options.signal) options.signal.removeEventListener('abort', onAbort);
        ac.abort();

        if (options.returnMode === 'sync') {
          return {
            type: 'sync',
            resolved: allDels.filter((d) => resolvedIds.has(d.id)),
          };
        }
        const subscriptionId = crypto.randomUUID();
        setTimeout(() => {
          emitDelegationSubscriptionFired({
            chatId: options.chatId,
            subscriptionId,
            resolvedIds: Array.from(resolvedIds),
            ...(options.callerAgentId ? { callerAgentId: options.callerAgentId } : {}),
            ...(options.callerSubagentId ? { callerSubagentId: options.callerSubagentId } : {}),
            ...(options.callerSessionId ? { callerSessionId: options.callerSessionId } : {}),
            ...(options.callerTurnId ? { callerTurnId: options.callerTurnId } : {}),
          });
        }, 0);
        return { type: 'subscription', subscriptionId };
      }

      if (options.returnMode === 'subscribe') {
        clearTimeout(timeout);
        if (options.signal) options.signal.removeEventListener('abort', onAbort);
        ac.abort();

        const subscriptionId = crypto.randomUUID();
        globalSubscriptions.set(subscriptionId, { options, resolvedIds });
        return { type: 'subscription', subscriptionId };
      }

      // Sync Wait mode: Wait for events
      for await (const [event] of eventIterator) {
        if (event.chatId === options.chatId && options.ids.includes(event.delegationId)) {
          resolvedIds.add(event.delegationId);

          if (checkCondition()) {
            clearTimeout(timeout);
            if (options.signal) options.signal.removeEventListener('abort', onAbort);

            const finalResolved: Delegation[] = [];
            for (const id of resolvedIds) {
              const del = await this.get(options.chatId, id);
              if (del) finalResolved.push(del);
            }
            return { type: 'sync', resolved: finalResolved };
          }
        }
      }
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'name' in err && err.name === 'AbortError') {
        const partialResolved: Delegation[] = [];
        for (const id of resolvedIds) {
          const del = await this.get(options.chatId, id);
          if (del) partialResolved.push(del);
        }
        return { type: 'sync', resolved: partialResolved };
      }
      throw err;
    } finally {
      clearTimeout(timeout);
      if (options.signal) options.signal.removeEventListener('abort', onAbort);
      ac.abort();
    }

    return { type: 'sync', resolved: [] };
  }

  unsubscribe(subscriptionId: string): boolean {
    return globalSubscriptions.delete(subscriptionId);
  }
}
