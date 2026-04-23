import type { CronJob } from '../../shared/config.js';

export interface RouterState {
  messageId: string;
  message: string;
  chatId: string;
  agentId?: string;
  subagentId?: string;
  sessionId?: string;
  nextSessionId?: string;
  env?: Record<string, string>;
  reply?: string;
  action?: 'stop' | 'interrupt' | 'continue';
  externalRef?: string;
  jobs?: {
    add?: CronJob[];
    remove?: string[];
  };
  /**
   * CronJob id that fired this turn, when the router state was seeded by
   * `cron.executeJob`. Threaded through to the `SystemMessage` so adapters
   * can render a terse header instead of the prompt text.
   */
  jobId?: string;
}
