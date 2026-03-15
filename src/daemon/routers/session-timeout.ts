import type { RouterState } from './types.js';
import crypto from 'node:crypto';

export interface SessionTimeoutConfig {
  timeoutMinutes?: number;
  prompt?: string;
}

export function createSessionTimeoutRouter(config: SessionTimeoutConfig = {}) {
  const timeoutMinutes = config.timeoutMinutes ?? 15;
  const prompt = config.prompt ?? 'Session expired due to inactivity.';

  return function (state: RouterState): RouterState {
    if (state.env?.__SESSION_TIMEOUT__ === 'true') {
      return {
        ...state,
        nextSessionId: crypto.randomUUID(),
        reply: prompt,
        jobs: {
          ...state.jobs,
          remove: [...(state.jobs?.remove || []), '__session_timeout__'],
        },
      };
    }

    return {
      ...state,
      jobs: {
        ...state.jobs,
        add: [
          ...(state.jobs?.add || []),
          {
            id: '__session_timeout__',
            message: '',
            schedule: { every: `${timeoutMinutes}m` },
            env: { __SESSION_TIMEOUT__: 'true' },
          },
        ],
        remove: [...(state.jobs?.remove || []), '__session_timeout__'],
      },
    };
  };
}
