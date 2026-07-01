import type { Delegation, DelegationState } from '../shared/delegations.js';
import type { DelegationStore } from './delegation-store.js';
import type { ObserverRegistry, PendingWaiter, WaitMode } from './delegation-observers.js';

// Discriminated outcome for `markResolved`. Mirrors the terminal states in
// `DelegationState`. Defined here (rather than the manager) so it can be
// imported by the helper without creating a cycle.
export type ResolvedOutcome =
  | { state: 'completed'; executionResult?: { stdout: string; stderr: string; exitCode: number } }
  | { state: 'failed'; reason?: string }
  | { state: 'rejected'; reason: string };

export function buildResolvedRecord(record: Delegation, outcome: ResolvedOutcome): Delegation {
  const resolvedAt = new Date().toISOString();
  if (outcome.state === 'completed') {
    if (record.kind === 'policy') {
      return {
        ...record,
        state: 'completed',
        resolvedAt,
        ...(outcome.executionResult ? { executionResult: outcome.executionResult } : {}),
      };
    }
    return { ...record, state: 'completed', resolvedAt };
  }
  if (outcome.state === 'failed') {
    return {
      ...record,
      state: 'failed',
      resolvedAt,
      ...(outcome.reason ? { rejectionReason: outcome.reason } : {}),
    };
  }
  return { ...record, state: 'rejected', resolvedAt, rejectionReason: outcome.reason };
}

// Multi-id sync wait helper used by `DelegationManager.wait`. Lives in its
// own module so the manager file stays under the per-file line cap. Ticket
// 5 generalises the original single-id implementation: multi-id, `mode:
// 'all'`, `return: 'subscribe'`. Subscriptions live on the
// `ObserverRegistry` (and on disk); the sync path registers a one-shot
// waiter that resolves when the registry reports the mode is satisfied.

export function isTerminalState(state: DelegationState): boolean {
  return state === 'completed' || state === 'rejected' || state === 'failed';
}

export interface SyncWaitInput {
  ids: string[];
  mode: WaitMode;
  chatId: string;
  timeoutMs: number;
}

// Registers a sync waiter with the registry, returning the standard
// `{resolved, pending}` shape on either `mode` satisfaction or `timeoutMs`
// expiry. The timeout path re-reads each id from disk so callers see the
// latest state (a record may have resolved between the last event and the
// timer firing).
export function waitForIds(
  store: DelegationStore,
  observers: ObserverRegistry,
  input: SyncWaitInput
): Promise<{ resolved: Delegation[]; pending: Delegation[] }> {
  return new Promise((resolve) => {
    let settled = false;
    const settleOnce = (resolved: Delegation[], pending: Delegation[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      discard();
      resolve({ resolved, pending });
    };
    const waiter: PendingWaiter = {
      kind: 'waiter',
      chatId: input.chatId,
      members: input.ids.map((id) => ({ id })),
      mode: input.mode,
      resolve: (resolvedSet, pendingSet) => settleOnce(resolvedSet, pendingSet),
    };
    const discard = observers.registerWaiter(waiter);
    const timer = setTimeout(async () => {
      if (settled) return;
      const fresh = await loadAll(store, input.chatId, input.ids);
      const resolved = fresh.filter((d) => isTerminalState(d.state));
      const pending = fresh.filter((d) => !isTerminalState(d.state));
      settleOnce(resolved, pending);
    }, input.timeoutMs);

    // Fast path: every id is already terminal on disk. The registry handles
    // this synchronously and fires the waiter inline.
    void observers.fastPathIfSatisfied(waiter);
  });
}

async function loadAll(
  store: DelegationStore,
  chatId: string,
  ids: string[]
): Promise<Delegation[]> {
  const out: Delegation[] = [];
  for (const id of ids) {
    const rec = await store.load(chatId, id);
    if (rec) out.push(rec);
  }
  return out;
}

// Compat shim: the old `waitForSingleId` API kept until callers migrate.
// The new code routes through `waitForIds`. We keep the export so
// `delegation-manager.ts` doesn't break mid-refactor (and so future
// single-id callers can still get the slimmest possible API).
export function waitForSingleId(
  store: DelegationStore,
  observers: ObserverRegistry,
  chatId: string,
  id: string,
  timeoutMs: number
): Promise<{ resolved: Delegation[]; pending: Delegation[] }> {
  return waitForIds(store, observers, { ids: [id], mode: 'any', chatId, timeoutMs });
}
