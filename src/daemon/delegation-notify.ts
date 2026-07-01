import { randomUUID } from 'node:crypto';
import type { Delegation } from '../shared/delegations.js';
import type { SystemMessage } from '../shared/chats.js';
import { appendMessage } from './chats.js';

// Helpers for appending the `<notification>` chat message that subscriptions
// fire when their `mode` is satisfied. Lives in its own module so the
// observer-registry code can re-use it without pulling in `chats.ts` from
// inside `delegation-manager.ts` (cycle pressure: chats → events → manager
// would form a triangle).
//
// Today's per-id subagent completion notification kicks a fresh agent turn
// via `executeDirectMessage`. Ticket 5's aggregated subscription
// notification is structurally similar (a `system`-role message tagged
// `subagent_update` whose content starts with `<notification>`), but we only
// need the message append for the spec's "exactly one `<notification>` lands
// in the chat" assertion — kicking a fresh turn for the agent to consume is
// a Ticket 6+ concern when the agent-side CLI actually subscribes.

export async function appendNotification(
  chatId: string,
  sessionId: string,
  body: string
): Promise<void> {
  const msg: SystemMessage = {
    id: randomUUID(),
    role: 'system',
    event: 'subagent_update',
    content: body,
    timestamp: new Date().toISOString(),
    sessionId,
  };
  await appendMessage(chatId, msg);
}

// Spec §6.1: compact, summary-style payload. Layout follows the example in
// the spec — counts + comma-joined IDs by terminal state, no per-id inline
// output. The first line carries the mode for downstream readers. For
// `mode: 'any'` the observer can fire before every member resolves, so the
// summary reports the resolved fraction and lists the still-pending ids.
export function formatAggregateBody(
  resolved: Delegation[],
  mode: 'any' | 'all',
  pendingIds: string[] = []
): string {
  const completed = resolved.filter((d) => d.state === 'completed');
  const failed = resolved.filter((d) => d.state === 'failed');
  const rejected = resolved.filter((d) => d.state === 'rejected');

  const lines: string[] = ['<notification>'];
  const total = resolved.length + pendingIds.length;
  const header =
    pendingIds.length > 0
      ? `${resolved.length} of ${total} delegations resolved (mode: '${mode}').`
      : `All ${resolved.length} delegations resolved (mode: '${mode}').`;
  lines.push(header);
  if (completed.length > 0) {
    lines.push(`completed (${completed.length}): ${completed.map((d) => d.id).join(', ')}`);
  }
  if (failed.length > 0) {
    lines.push(`failed (${failed.length}):`);
    for (const d of failed) {
      lines.push(`  - ${d.id} (${d.kind}${d.rejectionReason ? `: ${d.rejectionReason}` : ''})`);
    }
  }
  if (rejected.length > 0) {
    lines.push(`rejected (${rejected.length}):`);
    for (const d of rejected) {
      lines.push(`  - ${d.id} (${d.kind}${d.rejectionReason ? `: ${d.rejectionReason}` : ''})`);
    }
  }
  if (pendingIds.length > 0) {
    lines.push(`still pending (${pendingIds.length}): ${pendingIds.join(', ')}`);
  }
  lines.push('</notification>');
  return lines.join('\n');
}
