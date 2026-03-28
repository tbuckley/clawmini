import type { ChatMessage } from '../chats.js';

export interface FilteringConfig {
  messages?: Record<string, boolean> | undefined;
}

export function shouldDisplayMessage(message: ChatMessage, config: FilteringConfig): boolean {
  const overrides = config.messages || {};

  if (overrides['all']) {
    return true;
  }

  // Explicitly hidden (overrides defaults and other implicit allows)
  if (overrides[message.role] === false) {
    return false;
  }
  if (message.displayRole && overrides[message.displayRole] === false) {
    return false;
  }
  if (message.subagentId && overrides['subagent'] === false) {
    return false;
  }

  const isSubagentAllowed = overrides['subagent'] === true;

  // Specific overrides
  if (overrides[message.role] === true) {
    if (!message.subagentId || isSubagentAllowed) {
      return true;
    }
  }
  if (message.displayRole && overrides[message.displayRole] === true) {
    if (!message.subagentId || isSubagentAllowed) {
      return true;
    }
  }
  if (message.subagentId && overrides['subagent'] === true) {
    return true;
  }

  // Evaluate default agent rules
  const isAgentDisplay =
    message.displayRole === 'agent' || message.role === 'agent' || message.role === 'legacy_log';

  // Subagents are hidden by default unless overridden
  if (isAgentDisplay && !message.subagentId) {
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
