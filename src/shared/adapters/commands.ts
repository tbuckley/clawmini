import fs from 'node:fs/promises';
import { shouldDisplayMessage, formatMessage, type FilteringConfig } from './filtering.js';
import type { ChatMessage } from '../chats.js';

export interface CommandTrpcClient {
  getMessages: {
    query: (args: { chatId: string; limit: number }) => Promise<ChatMessage[]>;
  };
}

const VALID_ROLES = new Set([
  'all',
  'subagent',
  'user',
  'agent',
  'command',
  'system',
  'tool',
  'policy',
  'subagent_status',
  'legacy_log',
]);

export async function handleAdapterCommand(
  content: string,
  config: FilteringConfig,
  configPath: string,
  trpcClient: CommandTrpcClient,
  chatId: string
): Promise<string | null> {
  const trimmed = content.trim();

  if (trimmed === '/show all') {
    config.messages = { all: true };
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
    return 'Configuration updated: Showing all messages.';
  }

  if (trimmed === '/hide all') {
    config.messages = {};
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
    return 'Configuration updated: Hidden all overrides (using defaults).';
  }

  if (trimmed.startsWith('/show ')) {
    const role = trimmed.slice(6).trim();
    if (!VALID_ROLES.has(role)) {
      return `Error: '${role}' is not a valid message role or special value. Valid options: ${Array.from(VALID_ROLES).join(', ')}`;
    }
    if (!config.messages) config.messages = {};
    config.messages[role] = true;
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
    return `Configuration updated: Showing messages for '${role}'.`;
  }

  if (trimmed.startsWith('/hide ')) {
    const role = trimmed.slice(6).trim();
    if (!VALID_ROLES.has(role)) {
      return `Error: '${role}' is not a valid message role or special value. Valid options: ${Array.from(VALID_ROLES).join(', ')}`;
    }
    if (!config.messages) config.messages = {};
    config.messages[role] = false;
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
    return `Configuration updated: Hiding messages for '${role}'.`;
  }

  if (trimmed === '/debug' || trimmed.startsWith('/debug ')) {
    const match = trimmed.match(/^\/debug\s+(\d+)$/);
    const limit = match ? parseInt(match[1] as string, 10) : 5;

    // Fetch recent messages
    // Fetch a larger batch since we need to filter them down
    const messages: ChatMessage[] = await trpcClient.getMessages.query({
      chatId,
      limit: limit * 10,
    });

    const ignoredMessages: ChatMessage[] = [];

    // Iterating backwards (newest to oldest)
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (!msg) continue;

      // Exclude user messages without subagentIds
      const isUserWithoutSubagent =
        (msg.role === 'user' || msg.displayRole === 'user') && !msg.subagentId;
      if (isUserWithoutSubagent) continue;

      const isDisplayed = shouldDisplayMessage(msg, config);
      if (!isDisplayed) {
        ignoredMessages.push(msg);
        if (ignoredMessages.length >= limit) {
          break;
        }
      }
    }

    if (ignoredMessages.length === 0) {
      return `No ignored background messages found.`;
    }

    // Reverse back to chronological order
    ignoredMessages.reverse();

    const formatted = ignoredMessages.map((msg) => formatMessage(msg)).join('\n\n---\n\n');
    return `**Debug Output (${ignoredMessages.length} ignored messages):**\n\n${formatted}`;
  }

  return null;
}
