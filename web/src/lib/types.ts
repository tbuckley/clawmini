export interface BaseMessage {
  role: string;
  content: string;
  timestamp: string;
}

export interface UserMessage extends BaseMessage {
  role: 'user';
}

export interface CommandLogMessage extends BaseMessage {
  role: 'log';
  command: string;
  cwd: string;
  exitCode: number;
  stdout?: string;
  stderr?: string;
}

export type ChatMessage = UserMessage | CommandLogMessage;
