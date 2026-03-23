import type { ChatMessage } from '../chats.js';

export interface Logger {
  log(msg: ChatMessage): Promise<void>;
}

export interface Message {
  id: string;
  content: string;
  env: Record<string, string>;
}

export type MaybePromise<T> = T | Promise<T>;
