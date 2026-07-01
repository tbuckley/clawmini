import { randomUUID } from 'node:crypto';
import type { Delegation, DelegationSubscription } from '../shared/delegations.js';
import type { DelegationStore } from './delegation-store.js';
import { appendNotification, formatAggregateBody } from './delegation-notify.js';

// In-memory coordination layer for `wait` / `subscribe`. The store owns the
// subscription file. This module owns the live state needed to:
//   - decide if a resolving delegation is "covered" by any observer (so the
//     per-id `delivery: 'notify'` wakeup is suppressed),
//   - dispatch the resolution into each covering observer,
//   - fire the observer once its `mode` is satisfied (sync waiter resolves;
//     subscription appends one aggregated `<notification>` and is deleted).
//
// The registry is keyed by `chatId` because subscriptions are chat-scoped per
// spec §6.

export type WaitMode = 'any' | 'all';

interface PendingMember {
  id: string;
  resolved?: Delegation;
}

export interface PendingWaiter {
  kind: 'waiter';
  chatId: string;
  members: PendingMember[];
  mode: WaitMode;
  resolve: (resolved: Delegation[], pending: Delegation[]) => void;
  // The timer/cleanup are owned by the caller (the wait-promise constructor);
  // when the registry fires the waiter it calls `resolve` and the caller
  // tears down the timer.
}

export interface PendingSubscription {
  kind: 'subscription';
  subscriptionId: string;
  chatId: string;
  originSessionId: string;
  members: PendingMember[];
  mode: WaitMode;
}

type Observer = PendingWaiter | PendingSubscription;

export class ObserverRegistry {
  // Indexed by chatId for fast suppression lookups. The same observer is
  // referenced from every member-id's bucket so `covering` is O(observers in
  // chat) not O(all observers in process).
  private byChat = new Map<string, Set<Observer>>();
  private store: DelegationStore;

  constructor(store: DelegationStore) {
    this.store = store;
  }

  setStore(store: DelegationStore): void {
    this.store = store;
  }

  // True if any unfired observer in `chatId` has `id` in its member list and
  // that member has not yet been claimed. Used by `markResolved` callers
  // (`executeSubagent`, `handlePolicyApprove`) to skip the per-id notification
  // when an observer will consume the resolution.
  isCovered(chatId: string, id: string): boolean {
    const observers = this.byChat.get(chatId);
    if (!observers) return false;
    for (const obs of observers) {
      if (obs.members.some((m) => m.id === id && !m.resolved)) return true;
    }
    return false;
  }

  registerWaiter(waiter: PendingWaiter): () => void {
    this.addToChat(waiter);
    return () => this.discardWaiter(waiter);
  }

  private discardWaiter(waiter: PendingWaiter): void {
    const set = this.byChat.get(waiter.chatId);
    if (!set) return;
    set.delete(waiter);
    if (set.size === 0) this.byChat.delete(waiter.chatId);
  }

  async registerSubscription(
    chatId: string,
    originSessionId: string,
    ids: string[],
    mode: WaitMode
  ): Promise<string> {
    const subscriptionId = `sub-${randomUUID().slice(0, 8)}`;
    const record: DelegationSubscription = {
      subscriptionId,
      chatId,
      originSessionId,
      ids,
      mode,
      createdAt: new Date().toISOString(),
    };
    await this.store.saveSubscription(record);

    const sub: PendingSubscription = {
      kind: 'subscription',
      subscriptionId,
      chatId,
      originSessionId,
      members: ids.map((id) => ({ id })),
      mode,
    };
    // Hydrate any already-terminal members so a subscription registered
    // after some ids resolved still fires correctly (spec §6 fan-out
    // mid-resolve). If the mode is satisfied at register time we fire
    // synchronously and never add the subscription to the live registry.
    for (const m of sub.members) {
      const rec = await this.store.load(chatId, m.id);
      if (rec && isTerminal(rec.state)) m.resolved = rec;
    }
    if (this.isSatisfied(sub)) {
      await this.fireSubscriptionInline(sub);
      return subscriptionId;
    }
    this.addToChat(sub);
    return subscriptionId;
  }

  // Fire a subscription that was satisfied at register-time (every member is
  // already terminal). Avoids the addToChat→onResolved→fire cycle for the
  // common "subscribe after fact" case.
  private async fireSubscriptionInline(sub: PendingSubscription): Promise<void> {
    const resolved = sub.members
      .filter((m): m is Required<PendingMember> => !!m.resolved)
      .map((m) => m.resolved);
    const pendingIds = sub.members.filter((m) => !m.resolved).map((m) => m.id);
    const body = formatAggregateBody(resolved, sub.mode, pendingIds);
    await appendNotification(sub.chatId, sub.originSessionId, body);
    await this.store.deleteSubscription(sub.chatId, sub.subscriptionId);
  }

  // Spec §5.2: unsubscribe discards the subscription without waiting for the
  // remaining members. Still-pending members revert to their declared
  // delivery on subsequent resolution (dropping the subscription un-suppresses
  // them). But members that already resolved *while covered* had their per-id
  // notification suppressed on the expectation the aggregate would fire — if
  // we dropped silently those completions would be lost. So when any member
  // has already resolved we emit a partial aggregate before discarding.
  async unsubscribe(subscriptionId: string): Promise<void> {
    // Find the matching subscription. Since we don't index by sub id we walk
    // each chat's set — observer counts are small (one per active fan-out).
    let target: PendingSubscription | undefined;
    let chatSet: Set<Observer> | undefined;
    for (const [, set] of this.byChat) {
      for (const obs of set) {
        if (obs.kind === 'subscription' && obs.subscriptionId === subscriptionId) {
          target = obs;
          chatSet = set;
          break;
        }
      }
      if (target) break;
    }
    if (!target || !chatSet) {
      // The in-memory record is gone (e.g. daemon restart wiped state). Try
      // to clean up any orphaned file too.
      // We don't know the chatId without the in-memory record, so we can't
      // remove the file by hand. This is fine: `wipeAll()` on next daemon
      // boot will clean it up.
      return;
    }
    chatSet.delete(target);
    if (chatSet.size === 0) this.byChat.delete(target.chatId);

    const resolved = target.members
      .filter((m): m is Required<PendingMember> => !!m.resolved)
      .map((m) => m.resolved);
    if (resolved.length > 0) {
      const pendingIds = target.members.filter((m) => !m.resolved).map((m) => m.id);
      const body = formatAggregateBody(resolved, target.mode, pendingIds);
      await appendNotification(target.chatId, target.originSessionId, body);
    }
    await this.store.deleteSubscription(target.chatId, subscriptionId);
  }

  // Called by the manager right after `markResolved` persists the new state
  // and before emitting the public event. Returns `wasCovered` so the caller
  // can decide whether to fire its own per-id notification.
  async onResolved(chatId: string, delegation: Delegation): Promise<{ wasCovered: boolean }> {
    const observers = this.byChat.get(chatId);
    if (!observers) return { wasCovered: false };
    const covering: Observer[] = [];
    for (const obs of observers) {
      const member = obs.members.find((m) => m.id === delegation.id);
      if (member && !member.resolved) {
        member.resolved = delegation;
        covering.push(obs);
      }
    }
    if (covering.length === 0) return { wasCovered: false };

    for (const obs of covering) {
      if (this.isSatisfied(obs)) {
        await this.fire(obs);
      }
    }
    return { wasCovered: true };
  }

  private isSatisfied(obs: Observer): boolean {
    if (obs.mode === 'any') return obs.members.some((m) => !!m.resolved);
    return obs.members.every((m) => !!m.resolved);
  }

  private async fire(obs: Observer): Promise<void> {
    const set = this.byChat.get(obs.chatId);
    if (set) {
      set.delete(obs);
      if (set.size === 0) this.byChat.delete(obs.chatId);
    }
    const resolved = obs.members
      .filter((m): m is Required<PendingMember> => !!m.resolved)
      .map((m) => m.resolved);
    if (obs.kind === 'waiter') {
      const pendingIds = obs.members.filter((m) => !m.resolved).map((m) => m.id);
      // Look up the still-pending records so callers see their last-known state.
      const pending: Delegation[] = [];
      for (const pid of pendingIds) {
        const rec = await this.store.load(obs.chatId, pid);
        if (rec) pending.push(rec);
      }
      obs.resolve(resolved, pending);
      return;
    }
    // subscription: append aggregated notification and delete file.
    const subPendingIds = obs.members.filter((m) => !m.resolved).map((m) => m.id);
    const body = formatAggregateBody(resolved, obs.mode, subPendingIds);
    await appendNotification(obs.chatId, obs.originSessionId, body);
    await this.store.deleteSubscription(obs.chatId, obs.subscriptionId);
  }

  // Eagerly fire a waiter when all of its members are already terminal
  // (callers may register a wait after the delegations already resolved).
  // Returns true if the registry consumed the waiter inline.
  async fastPathIfSatisfied(waiter: PendingWaiter): Promise<boolean> {
    // Hydrate any members that are already terminal on disk.
    for (const m of waiter.members) {
      if (m.resolved) continue;
      const rec = await this.store.load(waiter.chatId, m.id);
      if (rec && isTerminal(rec.state)) m.resolved = rec;
    }
    if (this.isSatisfied(waiter)) {
      await this.fire(waiter);
      return true;
    }
    return false;
  }

  // Test/diagnostic hook — wipe live registries. The store's `wipeAll` deals
  // with the on-disk subscriptions dir.
  clear(): void {
    this.byChat.clear();
  }

  private addToChat(obs: Observer): void {
    let set = this.byChat.get(obs.chatId);
    if (!set) {
      set = new Set();
      this.byChat.set(obs.chatId, set);
    }
    set.add(obs);
  }
}

function isTerminal(state: string): boolean {
  return state === 'completed' || state === 'rejected' || state === 'failed';
}
