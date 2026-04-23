import { EventEmitter } from 'node:events';
import type { ChatMessage } from '../shared/chats.js';

export const daemonEvents = new EventEmitter();

export const DAEMON_EVENT_MESSAGE_APPENDED = 'message-appended';
export const DAEMON_EVENT_TYPING = 'typing';
export const DAEMON_EVENT_TURN_STARTED = 'turn-started';
export const DAEMON_EVENT_TURN_ENDED = 'turn-ended';
/**
 * Unified event carrying both `ChatMessage` appends and turn lifecycle
 * events so a single `waitForMessages` subscription can interleave them
 * in emission order (no merge logic or messageQueue on the consumer side).
 */
export const DAEMON_EVENT_CHAT_STREAM = 'chat-stream';

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

export type TurnLifecycleEvent =
  | { type: 'started'; turnId: string; rootMessageId: string; externalRef?: string }
  | { type: 'ended'; turnId: string; outcome: 'ok' | 'error' };

export type ChatStreamItem =
  | { kind: 'message'; message: ChatMessage }
  | { kind: 'turn'; event: TurnLifecycleEvent };

export interface ChatStreamEnvelope {
  chatId: string;
  item: ChatStreamItem;
}

export function emitMessageAppended(chatId: string, message: ChatMessage) {
  daemonEvents.emit(DAEMON_EVENT_MESSAGE_APPENDED, { chatId, message });
  const envelope: ChatStreamEnvelope = { chatId, item: { kind: 'message', message } };
  daemonEvents.emit(DAEMON_EVENT_CHAT_STREAM, envelope);
}

export function emitTyping(chatId: string) {
  daemonEvents.emit(DAEMON_EVENT_TYPING, { chatId });
}

export function emitTurnStarted(event: TurnStartedEvent) {
  daemonEvents.emit(DAEMON_EVENT_TURN_STARTED, event);
  const lifecycle: TurnLifecycleEvent = {
    type: 'started',
    turnId: event.turnId,
    rootMessageId: event.rootMessageId,
    ...(event.externalRef ? { externalRef: event.externalRef } : {}),
  };
  const envelope: ChatStreamEnvelope = {
    chatId: event.chatId,
    item: { kind: 'turn', event: lifecycle },
  };
  daemonEvents.emit(DAEMON_EVENT_CHAT_STREAM, envelope);
}

export function emitTurnEnded(event: TurnEndedEvent) {
  daemonEvents.emit(DAEMON_EVENT_TURN_ENDED, event);
  const lifecycle: TurnLifecycleEvent = {
    type: 'ended',
    turnId: event.turnId,
    outcome: event.outcome,
  };
  const envelope: ChatStreamEnvelope = {
    chatId: event.chatId,
    item: { kind: 'turn', event: lifecycle },
  };
  daemonEvents.emit(DAEMON_EVENT_CHAT_STREAM, envelope);
}
