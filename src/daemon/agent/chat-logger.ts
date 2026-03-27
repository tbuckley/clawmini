import {
  appendMessage,
  getMessages,
  findLastMessage as findLastMessageFromStorage,
  type ChatMessage,
  type CommandLogMessage,
  type UserMessage,
} from '../chats.js';
import type { Logger } from './types.js';

export function createChatLogger(chatId: string, subagentId?: string): Logger {
  async function append<T extends ChatMessage>(msg: T): Promise<T> {
    const finalMsg = subagentId ? { ...msg, subagentId } : msg;
    await appendMessage(chatId, finalMsg);
    return finalMsg as T;
  }

  return {
    append,

    getMessages: async (limit?: number) => {
      const msgs = await getMessages(chatId);
      let filtered = msgs.filter((m) => m.subagentId === subagentId);
      if (limit !== undefined && limit > 0) {
        filtered = filtered.slice(-limit);
      }
      return filtered;
    },

    findLastMessage: async (predicate) => {
      return findLastMessageFromStorage(chatId, (msg: ChatMessage) => {
        if (msg.subagentId !== subagentId) return false;
        return predicate(msg);
      });
    },

    logUserMessage: async (msg) =>
      append({
        id: crypto.randomUUID(),
        role: 'user',
        content: msg,
        timestamp: new Date().toISOString(),
      } satisfies UserMessage),

    logCommandResult: async ({ messageId, content, command, cwd, result }) =>
      append({
        id: crypto.randomUUID(),
        role: 'command',
        content,
        timestamp: new Date().toISOString(),

        messageId,

        command,
        cwd,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      }),

    logSystemEvent: async ({ content }) =>
      append({
        id: crypto.randomUUID(),
        role: 'command',
        content,
        timestamp: new Date().toISOString(),

        messageId: crypto.randomUUID(),

        stderr: '',
        command: '',
        cwd: '',
        stdout: '',
        exitCode: 0,
      } satisfies CommandLogMessage),

    logAutomaticReply: async ({ messageId, content }) =>
      append({
        id: crypto.randomUUID(),
        role: 'command',
        content: content,
        timestamp: new Date().toISOString(),

        messageId,

        // TODO remove these
        stderr: '',
        stdout: '',
        command: 'router',
        cwd: process.cwd(),
        exitCode: 0,
      } satisfies CommandLogMessage),

    logCommandRetry: async ({ messageId, content, cwd }) =>
      append({
        id: crypto.randomUUID(),
        role: 'command',
        content,
        timestamp: new Date().toISOString(),

        messageId,

        // TODO remove these? Or include the actual command that was run?
        command: 'retry-delay',
        stderr: '',
        stdout: '',
        cwd,
        exitCode: 0,
      } satisfies CommandLogMessage),
  };
}
