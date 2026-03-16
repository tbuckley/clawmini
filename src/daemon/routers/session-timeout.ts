import type { RouterState } from './types.js';
import { randomUUID } from 'node:crypto';

export interface SessionTimeoutConfig {
  timeoutMinutes?: number;
  prompt?: string;
}

/**
 * Router that automatically starts a new session after a period of inactivity.
 *
 * To register this router, add it to your `~/.gemini/settings.json`:
 * ```json
 * {
 *   "routers": [
 *     {
 *       "use": "session-timeout",
 *       "with": {
 *         "timeoutMinutes": 15,
 *         "prompt": "This chat session has ended. Save any important details from it to your memory."
 *       }
 *     }
 *   ]
 * }
 * ```
 */
export function createSessionTimeoutRouter(config: SessionTimeoutConfig = {}) {
  const timeoutMinutes = config.timeoutMinutes ?? 15;
  const prompt =
    config.prompt ??
    'This chat session has ended. Save any important details from it to your memory.';

  return function (state: RouterState): RouterState {
    const jobs = {
      ...state.jobs,
      remove: [...(state.jobs?.remove || []), '__session_timeout__'],
    };

    if (state.env?.__SESSION_TIMEOUT__ === 'true') {
      return {
        ...state,
        nextSessionId: randomUUID(),
        message: prompt,
        reply: '[clawmini/session-timeout] Session timed out',
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
            schedule: { at: `${timeoutMinutes}m` },
            message: prompt,
            reply: '[clawmini/session-timeout] Session timed out',
            nextSessionId: randomUUID(),
          },
        ],
      },
    };
  };
}
