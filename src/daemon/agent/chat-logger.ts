import {
  appendMessage,
  getMessages,
  findLastMessage as findLastMessageFromStorage,
  type ChatMessage,
  type CommandLogMessage,
  type UserMessage,
  type SystemMessage,
  type AgentReplyMessage,
  type ToolMessage,
  type PolicyRequestMessage,
  type SubagentStatusMessage,
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
        role: 'system',
        content,
        timestamp: new Date().toISOString(),

        messageId,
        event: 'router',
        displayRole: 'agent',
      } satisfies SystemMessage),

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

    logSystemMessage: async ({ content, event, messageId, displayRole }) => {
      const msg: SystemMessage = {
        id: crypto.randomUUID(),
        role: 'system',
        content,
        event,
        timestamp: new Date().toISOString(),
      };
      if (messageId !== undefined) {
        msg.messageId = messageId;
      }
      if (displayRole !== undefined) {
        msg.displayRole = displayRole;
      }
      return append<SystemMessage>(msg);
    },

    logSubagentStatus: async ({ subagentId: targetSubagentId, status }) => {
      const msg: SubagentStatusMessage = {
        id: crypto.randomUUID(),
        role: 'subagent_status',
        content: `Subagent ${status}`,
        subagentId: targetSubagentId,
        status,
        timestamp: new Date().toISOString(),
      };
      return append<SubagentStatusMessage>(msg);
    },

    logAgentReply: async ({ content, files, messageId }) => {
      const msg: AgentReplyMessage = {
        id: crypto.randomUUID(),
        role: 'agent',
        content,
        timestamp: new Date().toISOString(),
      };
      if (files !== undefined) {
        msg.files = files;
      }
      if (messageId !== undefined) {
        msg.messageId = messageId;
      }
      return append<AgentReplyMessage>(msg);
    },

    logToolMessage: async ({ content, messageId, name, payload }) => {
      const msg: ToolMessage = {
        id: crypto.randomUUID(),
        role: 'tool',
        content,
        messageId,
        name,
        payload,
        timestamp: new Date().toISOString(),
      };
      return append<ToolMessage>(msg);
    },

    logPolicyRequestMessage: async ({
      content,
      messageId,
      requestId,
      commandName,
      args,
      status,
    }) => {
      const msg: PolicyRequestMessage = {
        id: crypto.randomUUID(),
        role: 'policy',
        content,
        messageId,
        requestId,
        commandName,
        args,
        status,
        timestamp: new Date().toISOString(),
      };
      return append<PolicyRequestMessage>(msg);
    },
  };
}
