export interface BaseMessage {
  id: string;
  role: string;
  displayRole?: 'user' | 'agent';
  content: string;
  timestamp: string;
  subagentId?: string;
}

export interface UserMessage extends BaseMessage {
  role: 'user';
  agentContent?: string;
  files?: string[];
}

export interface AgentReplyMessage extends BaseMessage {
  role: 'agent';
  files?: string[];
}

export interface LogMessage extends BaseMessage {
  role: 'log';
  messageId: string;
  type?: 'tool' | 'unknown';
}

export interface CommandLogMessage extends BaseMessage {
  role: 'command';
  messageId: string;
  command: string;
  cwd: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  retryAttemptIndex?: number;
}

export interface SystemMessage extends BaseMessage {
  role: 'system';
  event: 'cron' | 'policy_approved' | 'policy_rejected' | 'subagent_update' | 'router' | 'other';
  messageId?: string;
}

export interface ToolMessage extends BaseMessage {
  role: 'tool';
  messageId: string;
  name: string;
  payload: unknown;
}

export interface PolicyRequestMessage extends BaseMessage {
  role: 'policy';
  messageId: string;
  requestId: string;
  commandName: string;
  args: string[];
  status: 'pending' | 'approved' | 'rejected';
}

export interface SubagentStatusMessage extends BaseMessage {
  role: 'subagent_status';
  subagentId: string;
  status: 'completed' | 'failed';
}

export interface LegacyLogMessage extends BaseMessage {
  role: 'legacy_log';
  messageId?: string;
  source?: string;
  files?: string[];
  level?: 'default' | 'debug' | 'verbose';
  command?: string;
  cwd?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}

export type ChatMessage =
  | UserMessage
  | AgentReplyMessage
  | LogMessage
  | CommandLogMessage
  | SystemMessage
  | ToolMessage
  | PolicyRequestMessage
  | SubagentStatusMessage
  | LegacyLogMessage;
