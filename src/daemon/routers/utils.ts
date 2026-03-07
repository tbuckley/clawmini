import type { RouterState } from './types.js';

export function createSlashActionRouter(
  command: string,
  action: NonNullable<RouterState['action']>,
  replyMessage: string
) {
  return function (state: RouterState): RouterState {
    const regex = new RegExp(`^\\/${command}(\\s|$)`);
    if (regex.test(state.message)) {
      const replaceRegex = new RegExp(`^\\/${command}(\\s+|$)`);
      const newMessage = state.message.replace(replaceRegex, '').trim();
      return {
        ...state,
        message: newMessage,
        action,
        reply: replyMessage,
      };
    }
    return state;
  };
}
