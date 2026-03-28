import * as shared from '../shared/chats.js';
import { emitMessageAppended } from './events.js';

export async function appendMessage(
  id: string,
  message: shared.ChatMessage,
  startDir = process.cwd()
): Promise<void> {
  await shared.appendMessage(id, message, startDir);
  emitMessageAppended(id, message);
}

export {
  type ChatMessage,
  type UserMessage,
  type CommandLogMessage,
  type SystemMessage,
  type AgentReplyMessage,
  type ToolMessage,
  type PolicyRequestMessage,
  type SubagentStatusMessage,
  getChatsDir,
  isValidChatId,
  createChat,
  listChats,
  deleteChat,
  getMessages,
  findLastMessage,
  getDefaultChatId,
  setDefaultChatId,
  DEFAULT_CHAT_ID,
} from '../shared/chats.js';
