import type {
  ChatMessage,
  CommandLogMessage,
  UserMessage,
  SystemMessage,
  AgentReplyMessage,
  ToolMessage,
  PolicyRequestMessage,
  SubagentStatusMessage,
} from '../chats.js';

export interface Logger {
  append<T extends ChatMessage>(msg: T): Promise<T>;
  getMessages(limit?: number): Promise<ChatMessage[]>;
  findLastMessage(predicate: (msg: ChatMessage) => boolean): Promise<ChatMessage | null>;
  logUserMessage(msg: string): Promise<UserMessage>;
  logSystemEvent(options: {
    content: string;
    level?: 'default' | 'debug' | 'verbose';
  }): Promise<CommandLogMessage>;
  logAutomaticReply(options: { messageId: string; content: string }): Promise<SystemMessage>;
  logCommandRetry(options: {
    messageId: string;
    content: string;
    cwd: string;
  }): Promise<CommandLogMessage>;
  logCommandResult(options: ExecutionResponse): Promise<CommandLogMessage>;
  logSystemMessage(options: {
    content: string;
    event: SystemMessage['event'];
    messageId?: string;
    displayRole?: 'user' | 'agent';
  }): Promise<SystemMessage>;
  logSubagentStatus(options: {
    subagentId: string;
    status: 'completed' | 'failed';
  }): Promise<SubagentStatusMessage>;
  logAgentReply(options: { content: string; files?: string[] }): Promise<AgentReplyMessage>;
  logToolMessage(options: {
    content: string;
    messageId: string;
    name: string;
    payload: unknown;
  }): Promise<ToolMessage>;
  logPolicyRequestMessage(options: {
    content: string;
    messageId: string;
    requestId: string;
    commandName: string;
    args: string[];
    status: 'pending' | 'approved' | 'rejected';
  }): Promise<PolicyRequestMessage>;
}

export interface Message {
  id: string;
  content: string;
  env: Record<string, string>;
}

export interface ExecutionResponse {
  messageId: string;
  content: string;
  command: string;
  cwd: string;
  result: RunCommandResult;
  extractedSessionId?: string | undefined;
}

export type RunCommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type RunCommandFn = (args: {
  command: string;
  cwd: string;
  env: Record<string, string>;
  stdin?: string | undefined;
  signal?: AbortSignal | undefined;
}) => Promise<RunCommandResult>;

export type MaybePromise<T> = T | Promise<T>;
