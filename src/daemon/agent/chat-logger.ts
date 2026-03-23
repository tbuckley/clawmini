import {
  appendMessage,
  type ChatMessage,
  type CommandLogMessage,
  type UserMessage,
} from '../chats.js';
import type { Logger } from './types.js';

export function createChatLogger(chatId: string): Logger {
  async function append<T extends ChatMessage>(msg: T): Promise<T> {
    await appendMessage(chatId, msg);
    return msg;
  }

  return {
    append,

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
        role: 'log',
        content,
        timestamp: new Date().toISOString(),

        messageId,
        ...getLogLevel(content),

        command,
        cwd,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      }),

    logAutomaticReply: async ({ messageId, content }) =>
      append({
        id: crypto.randomUUID(),
        role: 'log',
        content: content,
        timestamp: new Date().toISOString(),

        messageId,
        source: 'router',
        ...getLogLevel(content),

        // TODO remove these
        stderr: '',
        command: 'router',
        cwd: process.cwd(),
        exitCode: 0,
      } satisfies CommandLogMessage),

    logCommandRetry: async ({ messageId, content, cwd }) =>
      append({
        id: crypto.randomUUID(),
        role: 'log',
        content,
        timestamp: new Date().toISOString(),

        messageId,

        // TODO remove these? Or include the actual command that was run?
        command: 'retry-delay',
        stderr: '',
        cwd,
        exitCode: 0,
      } satisfies CommandLogMessage),
  };
}

function getLogLevel(content: string): { level?: 'default' | 'debug' | 'verbose' } {
  if (content.includes('NO_REPLY_NECESSARY')) {
    return { level: 'verbose' as const };
  }
  return {};
}
