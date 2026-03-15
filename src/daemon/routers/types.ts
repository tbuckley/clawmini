import type { CronJob } from '../../shared/config.js';

export interface RouterState {
  messageId: string;
  message: string;
  chatId: string;
  agentId?: string;
  sessionId?: string;
  nextSessionId?: string;
  env?: Record<string, string>;
  reply?: string;
  action?: 'stop' | 'interrupt' | 'continue';
  jobs?: {
    add?: CronJob[];
    remove?: string[];
  };
}
