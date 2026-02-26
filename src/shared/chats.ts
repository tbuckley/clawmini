import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { getClawminiDir, getSettingsPath } from './workspace.js';

export const DEFAULT_CHAT_ID = 'default';

export interface UserMessage {
  id: string;
  role: 'user';
  content: string;
  timestamp: string;
}

export interface CommandLogMessage {
  id: string;
  messageId: string;
  role: 'log';
  content: string;
  stderr: string;
  timestamp: string;
  command: string;
  cwd: string;
  exitCode: number;
  stdout?: string;
}

export type ChatMessage = UserMessage | CommandLogMessage;

export async function getChatsDir(startDir = process.cwd()): Promise<string> {
  const dir = path.join(getClawminiDir(startDir), 'chats');
  if (!existsSync(dir)) {
    await fs.mkdir(dir, { recursive: true });
  }
  return dir;
}

export async function createChat(id: string, startDir = process.cwd()): Promise<void> {
  const chatsDir = await getChatsDir(startDir);
  const chatDir = path.join(chatsDir, id);
  if (!existsSync(chatDir)) {
    await fs.mkdir(chatDir, { recursive: true });
  }
  const chatFile = path.join(chatDir, 'chat.jsonl');
  if (!existsSync(chatFile)) {
    await fs.writeFile(chatFile, '');
  }
}

export async function listChats(startDir = process.cwd()): Promise<string[]> {
  const chatsDir = await getChatsDir(startDir);
  try {
    const entries = await fs.readdir(chatsDir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

export async function deleteChat(id: string, startDir = process.cwd()): Promise<void> {
  const chatsDir = await getChatsDir(startDir);
  const chatsDirWithSep = chatsDir.endsWith(path.sep) ? chatsDir : chatsDir + path.sep;
  const chatDir = path.join(chatsDir, id);

  // Security check: Ensure we only delete inside the chats directory
  if (!chatDir.startsWith(chatsDirWithSep)) {
    throw new Error(`Security Error: Cannot delete chat directory outside of ${chatsDir}`);
  }

  if (existsSync(chatDir)) {
    await fs.rm(chatDir, { recursive: true, force: true });
  }
}

export async function appendMessage(
  id: string,
  message: ChatMessage,
  startDir = process.cwd()
): Promise<void> {
  const chatsDir = await getChatsDir(startDir);
  const chatDir = path.join(chatsDir, id);
  if (!existsSync(chatDir)) {
    await createChat(id, startDir);
  }
  const chatFile = path.join(chatDir, 'chat.jsonl');
  await fs.appendFile(chatFile, JSON.stringify(message) + '\n');
}

export async function getMessages(
  id: string,
  limit?: number,
  startDir = process.cwd()
): Promise<ChatMessage[]> {
  const chatsDir = await getChatsDir(startDir);
  const chatFile = path.join(chatsDir, id, 'chat.jsonl');
  if (!existsSync(chatFile)) {
    throw new Error(`Chat directory or file for '${id}' not found.`);
  }
  const content = await fs.readFile(chatFile, 'utf8');
  const lines = content.split('\n').filter((line) => line.trim() !== '');
  const messages = lines.map((line) => JSON.parse(line) as ChatMessage);

  if (limit !== undefined && limit > 0) {
    return messages.slice(-limit);
  }
  return messages;
}

export async function getDefaultChatId(startDir = process.cwd()): Promise<string> {
  const settingsPath = getSettingsPath(startDir);
  if (!existsSync(settingsPath)) return DEFAULT_CHAT_ID;

  try {
    const content = await fs.readFile(settingsPath, 'utf8');
    const settings = JSON.parse(content);
    return settings.chats?.defaultId || DEFAULT_CHAT_ID;
  } catch {
    return DEFAULT_CHAT_ID;
  }
}

export async function setDefaultChatId(id: string, startDir = process.cwd()): Promise<void> {
  const settingsPath = getSettingsPath(startDir);
  let settings: { chats?: { defaultId?: string; [key: string]: unknown }; [key: string]: unknown } =
    {};
  if (existsSync(settingsPath)) {
    try {
      const content = await fs.readFile(settingsPath, 'utf8');
      settings = JSON.parse(content);
    } catch {
      // Ignore invalid JSON
    }
  }

  if (!settings.chats) {
    settings.chats = {};
  }
  settings.chats.defaultId = id;

  const clawminiDir = getClawminiDir(startDir);
  if (!existsSync(clawminiDir)) {
    await fs.mkdir(clawminiDir, { recursive: true });
  }

  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
}
