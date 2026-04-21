import { EventEmitter } from 'node:events';
import type { ChatMessage } from '../shared/chats.js';

export const daemonEvents = new EventEmitter();

export const DAEMON_EVENT_MESSAGE_APPENDED = 'message-appended';
export const DAEMON_EVENT_TYPING = 'typing';
export const DAEMON_EVENT_TURN_STARTED = 'turn-started';
export const DAEMON_EVENT_TURN_ENDED = 'turn-ended';

export interface TurnStartedEvent {
  chatId: string;
  turnId: string;
  rootMessageId: string;
  externalRef?: string;
}

export interface TurnEndedEvent {
  chatId: string;
  turnId: string;
  outcome: 'ok' | 'error';
}

export function emitMessageAppended(chatId: string, message: ChatMessage) {
  daemonEvents.emit(DAEMON_EVENT_MESSAGE_APPENDED, { chatId, message });
}

export function emitTyping(chatId: string) {
  daemonEvents.emit(DAEMON_EVENT_TYPING, { chatId });
}

export function emitTurnStarted(event: TurnStartedEvent) {
  daemonEvents.emit(DAEMON_EVENT_TURN_STARTED, event);
}

export function emitTurnEnded(event: TurnEndedEvent) {
  daemonEvents.emit(DAEMON_EVENT_TURN_ENDED, event);
}
