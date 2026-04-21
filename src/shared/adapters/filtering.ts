import type { ChatMessage } from '../chats.js';

export interface FilteringConfig {
  filters?: Record<string, boolean> | undefined;
}

export type Destination =
  | { kind: 'drop' }
  | { kind: 'top-level' }
  | { kind: 'thread-log' }
  | { kind: 'thread-message' };

/**
 * Legacy boolean. Returns true if the message role is permitted to be
 * displayed at all; adapters that haven't migrated to `routeMessage` keep
 * using this unchanged.
 */
export function shouldDisplayMessage(message: ChatMessage, config: FilteringConfig): boolean {
  const overrides = config.filters || {};

  if (message.subagentId && overrides['subagent'] !== true) {
    return false;
  }

  const isStandardAgent =
    message.displayRole === 'agent' ||
    message.role === 'agent' ||
    message.role === 'legacy_log' ||
    (message.role === 'policy' && message.status === 'pending');

  if (isStandardAgent) return true;

  if (
    message.subagentId &&
    overrides['subagent'] === true &&
    (message.role === 'user' || message.displayRole === 'user')
  ) {
    return true;
  }

  if (
    overrides[message.role] === true ||
    (message.displayRole && overrides[message.displayRole] === true)
  ) {
    return true;
  }

  return false;
}

function defaultDestinationForRole(message: ChatMessage): Destination {
  if (message.role === 'user') return { kind: 'drop' };
  if (message.role === 'agent') return { kind: 'top-level' };
  if (message.role === 'legacy_log') return { kind: 'top-level' };
  if (message.role === 'tool') return { kind: 'thread-log' };
  if (message.role === 'subagent_status') return { kind: 'thread-log' };
  if (message.role === 'command') return { kind: 'drop' };
  if (message.role === 'policy') {
    return message.status === 'pending' ? { kind: 'thread-message' } : { kind: 'thread-log' };
  }
  if (message.role === 'system') {
    if (message.event === 'cron') return { kind: 'top-level' };
    if (message.event === 'policy_approved' || message.event === 'policy_rejected') {
      return { kind: 'thread-log' };
    }
    if (message.event === 'subagent_update') return { kind: 'thread-log' };
    return { kind: 'top-level' };
  }
  return { kind: 'drop' };
}

/**
 * Return the destination for a chat message given the adapter's filtering
 * config. Adapters that support threaded activity logs (Google Chat) use this
 * to decide whether each message becomes a top-level post, a thread-log entry,
 * a thread-message card, or is dropped entirely.
 *
 * A filter override of `true` on a role whose default destination is `drop`
 * promotes it to `top-level` (matching the legacy "opted in → show" behavior).
 * A filter override of `false` drops the role.
 *
 * Subagent messages route to their default destination when that default is a
 * thread one (tool calls, command logs, status updates all belong in the turn
 * log). They are dropped when the default is top-level — subagent prompts and
 * final replies are orchestration, not user-facing content — unless
 * `filters.subagent` is `true`, which surfaces them at top-level for debugging.
 */
export function routeMessage(message: ChatMessage, config: FilteringConfig): Destination {
  const overrides = config.filters || {};
  const defaultDest = defaultDestinationForRole(message);

  if (message.subagentId) {
    if (overrides['subagent'] === true) {
      return defaultDest.kind === 'drop' ? { kind: 'top-level' } : defaultDest;
    }
    // Everything produced inside a subagent — tool calls, command logs,
    // status updates, the prompt handed to it, and its final reply — belongs
    // in the parent turn's activity log. Thread-message (policy cards) is
    // preserved. Everything else folds into thread-log so the reader can see
    // what the subagent did.
    if (defaultDest.kind === 'thread-message') return defaultDest;
    return { kind: 'thread-log' };
  }

  const isStandardAgent =
    message.displayRole === 'agent' ||
    message.role === 'agent' ||
    message.role === 'legacy_log' ||
    (message.role === 'policy' && message.status === 'pending');

  if (isStandardAgent) return defaultDest;

  const roleFilter = overrides[message.role];
  const displayRoleFilter = message.displayRole ? overrides[message.displayRole] : undefined;

  if (roleFilter === false || displayRoleFilter === false) {
    return { kind: 'drop' };
  }

  if (roleFilter === true || displayRoleFilter === true) {
    return defaultDest.kind === 'drop' ? { kind: 'top-level' } : defaultDest;
  }

  return defaultDest;
}

export function formatMessage(message: ChatMessage): string {
  if (!message.subagentId) {
    return message.content;
  }

  const isToSubagent = message.role === 'user' || message.displayRole === 'user';
  if (isToSubagent) {
    return `[To:${message.subagentId}]\n${message.content}`;
  }

  return `[From:${message.subagentId}]\n${message.content}`;
}
