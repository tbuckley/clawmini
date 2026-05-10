import { DelegationStore } from './delegation-store.js';
import type {
  Delegation,
  PolicyDelegation,
  SubagentDelegation,
  DeliveryMode,
} from '../shared/delegations.js';
import crypto from 'node:crypto';
import { emitDelegationResolved } from './events.js';

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
}
