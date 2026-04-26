import type { RouterState } from './types.js';
import { detectInstall } from '../../cli/install-detection.js';
import { sendControlRequest } from '../../cli/supervisor-control.js';
import { enqueuePendingReply } from '../pending-replies.js';

export function slashUpgrade(state: RouterState): RouterState {
  if (!/^\/upgrade(\s|$)/.test(state.message)) return state;

  // Gated to user messages by USER_ROUTERS in resolveRouters.
  const info = detectInstall();
  if (!info.isNpmGlobal) {
    return {
      ...state,
      message: '',
      action: 'stop',
      reply:
        `Cannot upgrade: clawmini is not installed via \`npm install -g\` ` +
        `(running from ${info.entryRealPath}). Skipping.`,
    };
  }

  enqueuePendingReply({
    chatId: state.chatId,
    kind: 'upgrade-complete',
    messageId: state.messageId,
  });

  void sendControlRequest({ action: 'upgrade' }).catch((err) => {
    console.error(
      '[@clawmini/slash-upgrade] supervisor control request failed:',
      err instanceof Error ? err.message : err
    );
  });

  return {
    ...state,
    message: '',
    action: 'stop',
    reply: 'Upgrading clawmini... services will restart shortly.',
  };
}
