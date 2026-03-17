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
 *         "timeoutMinutes": 60,
 *         "prompt": "This chat session has ended. Save any important details from it to your memory."
 *       }
 *     }
 *   ]
 * }
 * ```
 */
export function createSessionTimeoutRouter(config: SessionTimeoutConfig = {}) {
  const timeoutMinutes = config.timeoutMinutes ?? 60;
  const prompt =
    config.prompt ??
    'This chat session has ended. Save any important details from it to your memory.';

  return function (state: RouterState): RouterState {
    const jobs = {
      ...state.jobs,
      remove: [...(state.jobs?.remove || []), '__session_timeout__'],
    };

    return {
      ...state,
      jobs: {
        ...jobs,
        add: [
          ...(jobs?.add || []),
          // Add a job after the timeout that will send the prompt, reply to the user,
          // start a fresh session, and delete the job
          {
            id: '__session_timeout__',
            schedule: { at: `${timeoutMinutes}m` },
            message: prompt,
            reply: '[@clawmini/session-timeout] Starting a fresh session...',
            nextSessionId: randomUUID(),
            jobs: {
              remove: ['__session_timeout__'],
            },
          },
        ],
      },
    };
  };
}
