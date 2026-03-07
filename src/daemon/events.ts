import { EventEmitter } from 'node:events';
import type { ChatMessage } from '../shared/chats.js';

export const daemonEvents = new EventEmitter();

export const DAEMON_EVENT_MESSAGE_APPENDED = 'message-appended';
export const DAEMON_EVENT_TYPING = 'typing';

export function emitMessageAppended(chatId: string, message: ChatMessage) {
  daemonEvents.emit(DAEMON_EVENT_MESSAGE_APPENDED, { chatId, message });
}

export function emitTyping(chatId: string) {
  daemonEvents.emit(DAEMON_EVENT_TYPING, { chatId });
}
