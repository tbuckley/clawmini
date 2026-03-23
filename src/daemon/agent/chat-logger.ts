import { appendMessage, type ChatMessage } from '../chats.js';

export function createChatLogger(chatId: string) {
  return {
    log: async (msg: ChatMessage) => {
      await appendMessage(chatId, msg);
    },
  };
}
