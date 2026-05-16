import type { Delegation, DelegationState } from '../shared/delegations.js';
import {
  daemonEvents,
  DAEMON_EVENT_DELEGATION_RESOLVED,
  type DelegationResolvedEvent,
} from './events.js';
import type { DelegationStore } from './delegation-store.js';

// Single-id sync wait helper used by `DelegationManager.wait`. Lives in its
// own module so the manager file stays under the per-file line cap. Ticket 5
// generalises this to multi-id / `mode: 'all'` / `return: 'subscribe'`; for
// now the only caller is `subagentWait`, which always asks for a single id.
export function isTerminalState(state: DelegationState): boolean {
  return state === 'completed' || state === 'rejected' || state === 'failed';
}

export function waitForSingleId(
  store: DelegationStore,
  chatId: string,
  id: string,
  timeoutMs: number
): Promise<{ resolved: Delegation[]; pending: Delegation[] }> {
  return new Promise((resolve) => {
    const onResolved = (ev: DelegationResolvedEvent) => {
      if (ev.chatId !== chatId) return;
      if (ev.delegation.id !== id) return;
      cleanup();
      resolve({ resolved: [ev.delegation], pending: [] });
    };
    const timer = setTimeout(async () => {
      cleanup();
      // Re-read in case the record resolved between our last check and the
      // timeout (the event listener handles the common path).
      const latest = await store.load(chatId, id);
      if (latest && isTerminalState(latest.state)) {
        resolve({ resolved: [latest], pending: [] });
      } else {
        resolve({
          resolved: [],
          pending: latest ? [latest] : [],
        });
      }
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      daemonEvents.off(DAEMON_EVENT_DELEGATION_RESOLVED, onResolved);
    };
    daemonEvents.on(DAEMON_EVENT_DELEGATION_RESOLVED, onResolved);
  });
}
