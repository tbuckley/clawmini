import { TRPCError } from '@trpc/server';
import { delegationManager } from '../delegation-manager.js';
import type { SubagentDelegation, DeliveryMode } from '../../shared/delegations.js';

// Shared helpers used by both `subagent-router.ts` and
// `subagent-creation.ts`. Extracted so each file can stay under the
// `max-lines: 300` ESLint cap.

export const MAX_SUBAGENT_DEPTH = 2;

/**
 * Map the legacy boolean `async` flag to the new `delivery` mode. Spec §3.3:
 *   - explicit `delivery` wins,
 *   - else `async: true → 'notify'`, `async: false → 'manual'`,
 *   - else default by depth (root → 'notify', subagent → 'manual').
 * `async` survives one release as a deprecated alias (see Ticket 8).
 */
export function resolveDelivery(
  delivery: DeliveryMode | undefined,
  asyncFlag: boolean | undefined,
  depth: number
): DeliveryMode {
  if (delivery !== undefined) return delivery;
  if (asyncFlag !== undefined) return asyncFlag ? 'notify' : 'manual';
  return depth === 0 ? 'notify' : 'manual';
}

/**
 * Convert the manager's `assertVisibleTo` errors into `TRPCError` so the wire
 * surface matches the legacy `assertSubagentAccess` codes (NOT_FOUND /
 * FORBIDDEN). All RPCs that touch an existing subagent should authorize via
 * this helper.
 */
export async function assertVisibleSubagent(
  callerSubagentId: string | undefined,
  id: string,
  chatId: string
): Promise<SubagentDelegation> {
  try {
    return await delegationManager.assertVisibleTo(callerSubagentId, id, chatId);
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    const message = err instanceof Error ? err.message : String(err);
    if (code === 'NOT_FOUND') {
      throw new TRPCError({ code: 'NOT_FOUND', message });
    }
    if (code === 'FORBIDDEN') {
      throw new TRPCError({ code: 'FORBIDDEN', message });
    }
    throw err;
  }
}
