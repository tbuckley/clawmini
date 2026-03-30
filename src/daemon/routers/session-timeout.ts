import type { RouterState } from './types.js';
import { randomUUID } from 'node:crypto';

export interface SessionTimeoutConfig {
  timeout?: string;
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
 *         "timeout": "60m",
 *         "prompt": "This chat session has ended. Save any important details from it to your memory. When finished, reply with NO_REPLY_NECESSARY."
 *       }
 *     }
 *   ]
 * }
 * ```
 */
export function createSessionTimeoutRouter(config: SessionTimeoutConfig = {}) {
  const timeStr = config.timeout ?? '60m';
  const prompt =
    config.prompt ??
    'This chat session has ended. Save any important details from it to your memory. When finished, reply with NO_REPLY_NECESSARY.';

  return function (state: RouterState): RouterState {
    if (state.env?.__SESSION_TIMEOUT__ === 'true') {
      return state;
    }

    const sessionId = state.sessionId || crypto.randomUUID();
    const jobId = `__session_timeout__${sessionId}`;

    const jobs = {
      ...state.jobs,
      remove: [...(state.jobs?.remove || []), jobId, '__session_timeout__'],
    };

    return {
      ...state,
      sessionId,
      jobs: {
        ...jobs,
        add: [
          ...(jobs.add || []),
          // Add a job after the timeout that will send the prompt, reply to the user,
          // start a fresh session, and delete the job
          {
            id: jobId,
            schedule: { at: timeStr },
            message: prompt,
            reply: '[@clawmini/session-timeout] Starting a fresh session...',
            nextSessionId: randomUUID(),
            session: { type: 'existing', id: sessionId },
            env: { __SESSION_TIMEOUT__: 'true' },
            jobs: {
              remove: [jobId],
            },
          },
        ],
      },
    };
  };
}
