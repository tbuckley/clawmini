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

// Cross-kind manager for policy + subagent delegations. The store is the
// thin file-IO layer; this class owns the state machine, event emission,
// and (in later tickets) the wait/subscribe coordination. Mirrors the
// `taskScheduler` / `cronManager` singleton pattern: a module-scope export
// at the bottom of the file holds the live instance for the daemon.
//
// Scope note for Ticket 1: only the creation + lifecycle + observation
// methods are wired. `wait`, `unsubscribe`, and `sendToSubagent` are stubbed
// and throw — Ticket 4 fills in `sendToSubagent`, Ticket 5 fills in
// `wait` + `unsubscribe`.

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
}

export interface DelegationListFilter {
  chatId?: string;
  kind?: DelegationKind;
  state?: DelegationState | DelegationState[];
  parentId?: string;
}

// Discriminated outcome for `markResolved`. Mirrors the terminal states in
// `DelegationState`:
//   - `completed` carries the policy `executionResult` (omit for subagents).
//   - `failed` may include a free-form reason for diagnostics.
//   - `rejected` is reached via `reject(id, reason)` rather than markResolved,
//     but we accept it here too for symmetry with the spec's `ResolvedOutcome`.
export type ResolvedOutcome =
  | { state: 'completed'; executionResult?: { stdout: string; stderr: string; exitCode: number } }
  | { state: 'failed'; reason?: string }
  | { state: 'rejected'; reason: string };

// Subscription/waiter maps are populated by Ticket 5. They live here so the
// state-machine code paths in this ticket compile against a stable shape.
interface PendingSubscription {
  subscriptionId: string;
  chatId: string;
  ids: string[];
  mode: 'any' | 'all';
}

interface PendingWaiter {
  chatId: string;
  ids: string[];
  mode: 'any' | 'all';
  resolve: (resolved: Delegation[]) => void;
}

export class DelegationManager {
  private _store: DelegationStore | null;
  // Reserved for Ticket 5: in-memory subscription/waiter registries keyed by
  // chat. Populated by `wait` and consumed by `markResolved`.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private subscriptions = new Map<string, PendingSubscription[]>();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private waiters = new Map<string, PendingWaiter[]>();

  constructor(store?: DelegationStore) {
    // Defer constructing the default store until first use so that the
    // module-scope singleton below doesn't read the workspace root at
    // import time (which would race tests that mock `getWorkspaceRoot`).
    this._store = store ?? null;
  }

  private get store(): DelegationStore {
    if (!this._store) {
      this._store = new DelegationStore(getWorkspaceRoot());
    }
    return this._store;
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
    const id = await this.store.generateId(input.chatId);
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

  // Stub — implemented in Ticket 4 (approval gating on send).
  async sendToSubagent(_id: string, _prompt: string): Promise<void> {
    throw new Error('not-implemented: DelegationManager.sendToSubagent (Ticket 4)');
  }

  // --- lifecycle ---

  async approve(id: string, _by: 'user' | 'auto'): Promise<void> {
    const record = await this.findById(id);
    if (!record) {
      throw new Error(`Delegation not found: ${id}`);
    }
    if (record.state !== 'pending') {
      throw new Error(
        `Cannot approve delegation ${id}: expected state 'pending', got '${record.state}'`
      );
    }
    const updated: Delegation = { ...record, state: 'running' };
    await this.store.save(updated);
  }

  async reject(id: string, reason: string): Promise<void> {
    const record = await this.findById(id);
    if (!record) {
      throw new Error(`Delegation not found: ${id}`);
    }
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
    emitDelegationResolved({ chatId: updated.chatId, delegation: updated });
  }

  async markResolved(id: string, outcome: ResolvedOutcome): Promise<void> {
    const record = await this.findById(id);
    if (!record) {
      throw new Error(`Delegation not found: ${id}`);
    }
    if (record.state !== 'running') {
      throw new Error(
        `Cannot resolve delegation ${id}: expected state 'running', got '${record.state}'`
      );
    }

    const resolvedAt = new Date().toISOString();
    let updated: Delegation;
    if (outcome.state === 'completed') {
      if (record.kind === 'policy') {
        updated = {
          ...record,
          state: 'completed',
          resolvedAt,
          ...(outcome.executionResult ? { executionResult: outcome.executionResult } : {}),
        };
      } else {
        updated = { ...record, state: 'completed', resolvedAt };
      }
    } else if (outcome.state === 'failed') {
      updated = {
        ...record,
        state: 'failed',
        resolvedAt,
        ...(outcome.reason ? { rejectionReason: outcome.reason } : {}),
      };
    } else {
      updated = {
        ...record,
        state: 'rejected',
        resolvedAt,
        rejectionReason: outcome.reason,
      };
    }

    await this.store.save(updated);
    emitDelegationResolved({ chatId: updated.chatId, delegation: updated });
  }

  // --- observation ---

  async get(id: string, chatId: string): Promise<Delegation | null> {
    return this.store.load(chatId, id);
  }

  async list(filter: DelegationListFilter): Promise<Delegation[]> {
    if (!filter.chatId) {
      // Spec §5.6 lists delegations per-chat (the store's natural index). A
      // cross-chat list would require walking every chat dir on disk — out
      // of scope for Ticket 1, and consumers always have a chatId today.
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

  // --- waiting / subscriptions (Ticket 5 fills these in) ---

  async wait(_opts: {
    ids: string[];
    mode: 'any' | 'all';
    return: 'sync' | 'subscribe';
    chatId: string;
    sessionId: string;
    timeoutMs?: number;
  }): Promise<unknown> {
    throw new Error('not-implemented: DelegationManager.wait (Ticket 5)');
  }

  async unsubscribe(_subscriptionId: string): Promise<void> {
    throw new Error('not-implemented: DelegationManager.unsubscribe (Ticket 5)');
  }

  // --- daemon lifecycle ---

  async wipeAll(): Promise<void> {
    await this.store.wipeAll();
    this.subscriptions.clear();
    this.waiters.clear();
  }

  // Helper: we accept (id, chatId) on the public observation API but the
  // lifecycle methods are addressed by id alone. The store is per-chat, so
  // we need to find the chat. For Ticket 1 callers always have chatId in
  // hand (creation paths), so this stays simple — but the public methods
  // `approve`/`reject`/`markResolved` take only `id` per spec §5.6, so we
  // need a lookup. The cheap path: callers create a record (we know its
  // chat) then immediately resolve it; tests load by walking. Later tickets
  // can add a (chatId → set of ids) cache if profiling shows it matters.
  private async findById(id: string): Promise<Delegation | null> {
    // We need to scan chat directories. The store doesn't expose that today,
    // so we use a small helper here. Mocked tests can override the store.
    // Implementation: read the base delegation directory, walk chat dirs,
    // try to load (chatId, id).
    return this.store.findById(id);
  }
}

export const delegationManager = new DelegationManager();
