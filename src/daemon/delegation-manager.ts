import { getWorkspaceRoot } from '../shared/workspace.js';
import {
  type Delegation,
  type DelegationKind,
  type DelegationState,
  type DeliveryMode,
  type PolicyDelegation,
  type SubagentDelegation,
} from '../shared/delegations.js';
import { DelegationStore } from './delegation-store.js';
import { emitDelegationResolved } from './events.js';
import {
  isTerminalState,
  waitForIds,
  buildResolvedRecord,
  type ResolvedOutcome,
} from './delegation-wait.js';
import { ObserverRegistry, type WaitMode } from './delegation-observers.js';

// Cross-kind manager for policy + subagent delegations. The store is the
// thin file-IO layer; this class owns the state machine, event emission,
// and the wait/subscribe coordination (Ticket 5). Mirrors the
// `taskScheduler` / `cronManager` singleton pattern.

export interface PolicyCreateInput {
  chatId: string;
  agentId: string;
  commandName: string;
  args: string[];
  fileMappings: Record<string, string>;
  cwd?: string;
  parentId?: string;
  delivery?: DeliveryMode;
  autoApprove?: boolean;
}

export interface SubagentCreateInput {
  chatId: string;
  agentId: string;
  targetAgentId: string;
  sessionId: string;
  prompt: string;
  parentId?: string;
  delivery?: DeliveryMode;
  autoApprove?: boolean;
  // Optional caller-supplied id. See Ticket 3 notes (`--id` back-compat).
  id?: string;
}

export interface DelegationListFilter {
  chatId?: string;
  kind?: DelegationKind;
  state?: DelegationState | DelegationState[];
  parentId?: string;
}

export interface SyncWaitInput {
  ids: string[];
  mode: WaitMode;
  return: 'sync';
  chatId: string;
  timeoutMs?: number;
}

export interface SubscribeWaitInput {
  ids: string[];
  mode: WaitMode;
  return: 'subscribe';
  chatId: string;
  originSessionId: string;
}

export type WaitInput = SyncWaitInput | SubscribeWaitInput;

export interface SyncWaitResult {
  resolved: Delegation[];
  pending: Delegation[];
}
export interface SubscribeWaitResult {
  subscriptionId: string;
}

export class DelegationManager {
  private _store: DelegationStore | null;
  private _observers: ObserverRegistry | null = null;

  constructor(store?: DelegationStore) {
    this._store = store ?? null;
  }

  private get store(): DelegationStore {
    if (!this._store) {
      this._store = new DelegationStore(getWorkspaceRoot());
    }
    return this._store;
  }

  private get observers(): ObserverRegistry {
    if (!this._observers) this._observers = new ObserverRegistry(this.store);
    else this._observers.setStore(this.store);
    return this._observers;
  }

  // --- creation ---

  async createPolicy(input: PolicyCreateInput): Promise<PolicyDelegation> {
    const id = await this.store.generateId(input.chatId);
    const delegation: PolicyDelegation = {
      id,
      kind: 'policy',
      state: input.autoApprove ? 'running' : 'pending',
      delivery: input.delivery ?? 'notify',
      chatId: input.chatId,
      agentId: input.agentId,
      ...(input.parentId ? { parentId: input.parentId } : {}),
      createdAt: new Date().toISOString(),
      commandName: input.commandName,
      args: input.args,
      fileMappings: input.fileMappings,
      ...(input.cwd ? { cwd: input.cwd } : {}),
    };
    await this.store.save(delegation);
    return delegation;
  }

  async createSubagent(input: SubagentCreateInput): Promise<SubagentDelegation> {
    let id: string;
    if (input.id !== undefined) {
      const existing = await this.store.load(input.chatId, input.id);
      if (existing) {
        throw new Error('Subagent ID already exists');
      }
      id = input.id;
    } else {
      id = await this.store.generateId(input.chatId);
    }
    const delegation: SubagentDelegation = {
      id,
      kind: 'subagent',
      state: input.autoApprove ? 'running' : 'pending',
      delivery: input.delivery ?? 'notify',
      chatId: input.chatId,
      agentId: input.agentId,
      ...(input.parentId ? { parentId: input.parentId } : {}),
      createdAt: new Date().toISOString(),
      targetAgentId: input.targetAgentId,
      sessionId: input.sessionId,
      prompt: input.prompt,
    };
    await this.store.save(delegation);
    return delegation;
  }

  async sendToSubagent(
    id: string,
    chatId: string,
    prompt: string,
    opts: { autoApprove: boolean }
  ): Promise<SubagentDelegation> {
    const record = await this.store.load(chatId, id);
    if (!record || record.kind !== 'subagent') {
      const err = new Error('Subagent not found') as Error & { code?: string };
      err.code = 'NOT_FOUND';
      throw err;
    }
    const nextState: SubagentDelegation['state'] = opts.autoApprove ? 'running' : 'pending';
    const updated: SubagentDelegation = { ...record, prompt, state: nextState };
    await this.store.save(updated);
    return updated;
  }

  // --- lifecycle ---

  async approve(id: string, _by: 'user' | 'auto'): Promise<void> {
    const record = await this.findById(id);
    if (!record) throw new Error(`Delegation not found: ${id}`);
    if (record.state !== 'pending') {
      throw new Error(
        `Cannot approve delegation ${id}: expected state 'pending', got '${record.state}'`
      );
    }
    const updated: Delegation = { ...record, state: 'running' };
    await this.store.save(updated);
  }

  async reject(id: string, reason: string): Promise<{ wasCovered: boolean }> {
    const record = await this.findById(id);
    if (!record) throw new Error(`Delegation not found: ${id}`);
    if (record.state !== 'pending') {
      throw new Error(
        `Cannot reject delegation ${id}: expected state 'pending', got '${record.state}'`
      );
    }
    const resolvedAt = new Date().toISOString();
    const updated: Delegation = {
      ...record,
      state: 'rejected',
      rejectionReason: reason,
      resolvedAt,
    };
    await this.store.save(updated);
    const { wasCovered } = await this.observers.onResolved(updated.chatId, updated);
    emitDelegationResolved({ chatId: updated.chatId, delegation: updated });
    return { wasCovered };
  }

  async markResolved(id: string, outcome: ResolvedOutcome): Promise<{ wasCovered: boolean }> {
    const record = await this.findById(id);
    if (!record) throw new Error(`Delegation not found: ${id}`);
    if (record.state !== 'running') {
      throw new Error(
        `Cannot resolve delegation ${id}: expected state 'running', got '${record.state}'`
      );
    }
    const updated = buildResolvedRecord(record, outcome);
    await this.store.save(updated);
    // Observers run *before* the public event so listeners on the event see
    // consistent observer state. The boolean lets callers (`executeSubagent`
    // / `handlePolicyApprove`) suppress their per-id notification.
    const { wasCovered } = await this.observers.onResolved(updated.chatId, updated);
    emitDelegationResolved({ chatId: updated.chatId, delegation: updated });
    return { wasCovered };
  }

  // --- observation ---

  async get(id: string, chatId: string): Promise<Delegation | null> {
    return this.store.load(chatId, id);
  }

  async list(filter: DelegationListFilter): Promise<Delegation[]> {
    if (!filter.chatId) {
      throw new Error('DelegationManager.list requires filter.chatId');
    }
    const storeFilter: {
      state?: DelegationState | DelegationState[];
      kind?: DelegationKind;
      parentId?: string;
    } = {};
    if (filter.state !== undefined) storeFilter.state = filter.state;
    if (filter.kind !== undefined) storeFilter.kind = filter.kind;
    if (filter.parentId !== undefined) storeFilter.parentId = filter.parentId;
    return this.store.list(filter.chatId, storeFilter);
  }

  async delete(id: string, chatId: string): Promise<void> {
    await this.store.delete(chatId, id);
  }

  async update(
    id: string,
    chatId: string,
    patch: Partial<Pick<SubagentDelegation, 'prompt' | 'state'>>
  ): Promise<Delegation> {
    const record = await this.store.load(chatId, id);
    if (!record) throw new Error(`Delegation not found: ${id}`);
    const updated: Delegation = { ...record, ...patch } as Delegation;
    await this.store.save(updated);
    return updated;
  }

  async assertVisibleTo(
    callerSubagentId: string | undefined,
    id: string,
    chatId: string
  ): Promise<SubagentDelegation> {
    const record = await this.store.load(chatId, id);
    if (!record || record.kind !== 'subagent') {
      const err = new Error('Subagent not found') as Error & { code?: string };
      err.code = 'NOT_FOUND';
      throw err;
    }
    if (record.parentId !== callerSubagentId) {
      const err = new Error('Subagent is not a child of the caller') as Error & {
        code?: string;
      };
      err.code = 'FORBIDDEN';
      throw err;
    }
    return record;
  }

  // True iff an unfired observer in `chatId` still has `id` as a pending
  // member. Used by callers that mint their own per-id notifications (today:
  // `executeSubagent`, policy approve) to short-circuit a redundant wakeup
  // when the manager's coordination layer is going to fire its own.
  isCoveredByObserver(chatId: string, id: string): boolean {
    return this.observers.isCovered(chatId, id);
  }

  // --- waiting / subscriptions ---

  async wait(input: SyncWaitInput): Promise<SyncWaitResult>;
  async wait(input: SubscribeWaitInput): Promise<SubscribeWaitResult>;
  async wait(input: WaitInput): Promise<SyncWaitResult | SubscribeWaitResult> {
    if (input.return === 'subscribe') {
      const id = await this.observers.registerSubscription(
        input.chatId,
        input.originSessionId,
        input.ids,
        input.mode
      );
      return { subscriptionId: id };
    }
    return waitForIds(this.store, this.observers, {
      ids: input.ids,
      mode: input.mode,
      chatId: input.chatId,
      timeoutMs: input.timeoutMs ?? 60_000,
    });
  }

  async unsubscribe(subscriptionId: string): Promise<void> {
    await this.observers.unsubscribe(subscriptionId);
  }

  // --- daemon lifecycle ---

  async wipeAll(): Promise<void> {
    await this.store.wipeAll();
    this._observers?.clear();
  }

  private async findById(id: string): Promise<Delegation | null> {
    return this.store.findById(id);
  }
}

export { isTerminalState };
export type { ResolvedOutcome };
export const delegationManager = new DelegationManager();
