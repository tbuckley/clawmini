import type { RouterState } from './types.js';
import { sendControlRequest } from '../../cli/supervisor-control.js';

export async function slashRestart(state: RouterState): Promise<RouterState> {
  if (!/^\/restart(\s|$)/.test(state.message)) return state;

  // Gated to user messages by USER_ROUTERS in resolveRouters — an agent
  // tool output that happens to start with "/restart" never reaches us.
  // The supervisor enqueues the post-restart "Clawmini restarted vX.Y.Z"
  // SystemMessage on its side so the on-disk record reflects whether the
  // restart was actually scheduled. We just plumb chatId + messageId
  // through and surface any control-channel error to the user.
  let res;
  try {
    res = await sendControlRequest({
      action: 'restart',
      chatId: state.chatId,
      messageId: state.messageId,
    });
  } catch (err) {
    return stop(
      state,
      `Could not reach supervisor: ${err instanceof Error ? err.message : String(err)}.`
    );
  }

  if (!res.ok) {
    return stop(state, `Restart aborted: ${res.error ?? 'unknown error'}.`);
  }

  return stop(state, 'Restarting clawmini...');
}

function stop(state: RouterState, reply: string): RouterState {
  return { ...state, message: '', action: 'stop', reply };
}
