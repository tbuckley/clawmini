export interface RouterState {
  message: string;
  chatId: string;
  agentId?: string;
  sessionId?: string;
  env?: Record<string, string>;
  reply?: string;
  action?: 'stop' | 'interrupt' | 'continue';
}
