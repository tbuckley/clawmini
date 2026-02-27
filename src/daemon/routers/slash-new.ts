import { randomUUID } from 'node:crypto';
import type { RouterState } from './types.js';

export function slashNew(state: RouterState): RouterState {
  if (/^\/new(\s|$)/.test(state.message)) {
    const newMessage = state.message.replace(/^\/new(\s+|$)/, '').trim();
    return {
      ...state,
      message: newMessage,
      sessionId: randomUUID(),
    };
  }
  return state;
}
