export interface RouterState {
  messageId: string;
  message: string;
  chatId: string;
  agentId?: string;
  sessionId?: string;
  env?: Record<string, string>;
  reply?: string;
  action?: 'stop' | 'interrupt' | 'continue';
}
