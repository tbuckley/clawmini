import type { RouterState } from './types.js';

export function slashStop(state: RouterState): RouterState {
  if (/^\/stop(\s|$)/.test(state.message)) {
    const newMessage = state.message.replace(/^\/stop(\s+|$)/, '').trim();
    return {
      ...state,
      message: newMessage,
      action: 'stop',
      reply: 'Stopping current task...',
    };
  }
  return state;
}
