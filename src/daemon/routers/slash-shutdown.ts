import type { RouterState } from './types.js';
import { sendControlRequest } from '../../cli/supervisor-control.js';

export function slashShutdown(state: RouterState): RouterState {
  if (!/^\/shutdown(\s|$)/.test(state.message)) return state;

  // Gated to user messages by USER_ROUTERS in resolveRouters — agents cannot
  // trigger this even via tool output that happens to start with /shutdown.
  void sendControlRequest({ action: 'shutdown' }).catch((err) => {
    console.error(
      '[@clawmini/slash-shutdown] supervisor control request failed:',
      err instanceof Error ? err.message : err
    );
  });

  return {
    ...state,
    message: '',
    action: 'stop',
    reply: 'Shutting down clawmini supervisor...',
  };
}
