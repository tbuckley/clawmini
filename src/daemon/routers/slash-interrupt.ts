import type { RouterState } from './types.js';

export function slashInterrupt(state: RouterState): RouterState {
  if (/^\/interrupt(\s|$)/.test(state.message)) {
    const newMessage = state.message.replace(/^\/interrupt(\s+|$)/, '').trim();
    return {
      ...state,
      message: newMessage,
      action: 'interrupt',
      reply: 'Interrupting current task...',
    };
  }
  return state;
}
