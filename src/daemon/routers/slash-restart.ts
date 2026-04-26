import type { RouterState } from './types.js';
import { sendControlRequest } from '../../cli/supervisor-control.js';
import { enqueuePendingReply } from '../pending-replies.js';

export function slashRestart(state: RouterState): RouterState {
  if (!/^\/restart(\s|$)/.test(state.message)) return state;

  // The supervisor's USER_ROUTERS gate (see resolveRouters) ensures this
  // router only runs for direct user messages — agent-emitted text never
  // reaches it.
  enqueuePendingReply({
    chatId: state.chatId,
    kind: 'restart-complete',
    messageId: state.messageId,
  });

  // Fire-and-forget: the supervisor schedules the restart via setImmediate,
  // so the in-flight `state.reply` ('Restarting...') flushes through the
  // tRPC subscription and reaches the adapter before the daemon dies.
  void sendControlRequest({ action: 'restart' }).catch((err) => {
    console.error(
      '[@clawmini/slash-restart] supervisor control request failed:',
      err instanceof Error ? err.message : err
    );
  });

  return {
    ...state,
    message: '',
    action: 'stop',
    reply: 'Restarting clawmini daemon...',
  };
}
