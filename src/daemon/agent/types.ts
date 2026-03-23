import type { ChatMessage, CommandLogMessage, UserMessage } from '../chats.js';

export interface Logger {
  append<T extends ChatMessage>(msg: T): Promise<T>;
  logUserMessage(msg: string): Promise<UserMessage>;
  logAutomaticReply(options: { messageId: string; content: string }): Promise<CommandLogMessage>;
  logCommandRetry(options: {
    messageId: string;
    content: string;
    cwd: string;
  }): Promise<CommandLogMessage>;
  logCommandResult(options: ExecutionResponse): Promise<CommandLogMessage>;
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
