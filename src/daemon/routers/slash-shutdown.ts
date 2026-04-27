import type { RouterState } from './types.js';
import { sendControlRequest } from '../../cli/supervisor-control.js';

export async function slashShutdown(state: RouterState): Promise<RouterState> {
  if (!/^\/shutdown(\s|$)/.test(state.message)) return state;

  // Gated to user messages by USER_ROUTERS in resolveRouters — agents cannot
  // trigger this even via tool output that happens to start with /shutdown.
  let res;
  try {
    res = await sendControlRequest({ action: 'shutdown' });
  } catch (err) {
    return stop(
      state,
      `Could not reach supervisor: ${err instanceof Error ? err.message : String(err)}.`
    );
  }

  if (!res.ok) {
    return stop(state, `Shutdown aborted: ${res.error ?? 'unknown error'}.`);
  }

  return stop(state, 'Shutting down clawmini supervisor...');
}

function stop(state: RouterState, reply: string): RouterState {
  return { ...state, message: '', action: 'stop', reply };
}
