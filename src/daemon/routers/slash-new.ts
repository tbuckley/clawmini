import type { RouterState } from './types.js';

export function slashNew(state: RouterState): RouterState {
  if (/^\/new(\s|$)/.test(state.message)) {
    const newMessage = state.message.replace(/^\/new(\s+|$)/, '').trim();
    const id = crypto.randomUUID();
    return {
      ...state,
      message: newMessage,
      sessionId: id,
      nextSessionId: id,
      reply: '[@clawmini/slash-new] Starting a new session...',
    };
  }
  return state;
}
