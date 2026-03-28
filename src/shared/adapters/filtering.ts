import type { ChatMessage } from '../chats.js';

export interface FilteringConfig {
  filters?: Record<string, boolean> | undefined;
}

export function shouldDisplayMessage(message: ChatMessage, config: FilteringConfig): boolean {
  const overrides = config.filters || {};

  // If the message has a subagentId, return false immediately unless subagent messages are allowed.
  if (message.subagentId && overrides['subagent'] !== true) {
    return false;
  }

  // Then check if it's a standard agent message (via role/displayRole) and always return true if so.
  const isStandardAgent = message.role === 'agent' || message.displayRole === 'agent';

  if (isStandardAgent) {
    return true;
  }

  // Then check if it's a user message directed to a subagent, if subagent messages are allowed
  if (
    message.subagentId &&
    overrides['subagent'] === true &&
    (message.role === 'user' || message.displayRole === 'user')
  ) {
    return true;
  }

  // Finally, check if the role is allowed and forward it if so.
  if (
    overrides[message.role] === true ||
    (message.displayRole && overrides[message.displayRole] === true)
  ) {
    return true;
  }

  return false;
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
