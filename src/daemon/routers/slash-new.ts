import type { RouterState } from './types.js';

export function slashNew(state: RouterState): RouterState {
  if (/^\/new(\s|$)/.test(state.message)) {
    const newMessage = state.message.replace(/^\/new(\s+|$)/, '').trim();
    return {
      ...state,
      message: newMessage,
      sessionId: crypto.randomUUID(),
      reply: '[@clawmini/slash-new] Starting a new session...',
    };
  }
  return state;
}
