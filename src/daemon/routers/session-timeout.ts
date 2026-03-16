import type { RouterState } from './types.js';
import { randomUUID } from 'node:crypto';

export interface SessionTimeoutConfig {
  timeoutMinutes?: number;
  prompt?: string;
}

export function createSessionTimeoutRouter(config: SessionTimeoutConfig = {}) {
  const timeoutMinutes = config.timeoutMinutes ?? 15;
  const prompt = config.prompt ?? 'This chat session has ended. Save any important details from it to your memory.';

  return function (state: RouterState): RouterState {
    const jobs = {
      ...state.jobs,
      remove: [...(state.jobs?.remove || []), '__session_timeout__'],
    };

    if (state.env?.__SESSION_TIMEOUT__ === 'true') {
      return {
        ...state,
        nextSessionId: randomUUID(),
        reply: prompt,
        jobs,
      };
    }

    return {
      ...state,
      jobs: {
        ...jobs,
        add: [
          ...(state.jobs?.add || []),
          {
            id: '__session_timeout__',
            message: '',
            schedule: { every: `${timeoutMinutes}m` },
            env: { __SESSION_TIMEOUT__: 'true' },
          },
        ],
      },
    };
  };
}
