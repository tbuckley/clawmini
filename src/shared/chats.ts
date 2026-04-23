/* eslint-disable max-lines */
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { getClawminiDir, getSettingsPath } from './workspace.js';
import { pathIsInsideDir } from './utils/fs.js';

export const DEFAULT_CHAT_ID = 'default';

export interface BaseMessage {
  id: string;
  role: string;
  displayRole?: 'user' | 'agent';
  content: string;
  timestamp: string;
  subagentId?: string;
  sessionId: string | undefined;
  turnId?: string;
}

export interface UserMessage extends BaseMessage {
  role: 'user';
  agentContent?: string;
  files?: string[];
}

export interface AgentReplyMessage extends BaseMessage {
  role: 'agent';
  files?: string[];
}

export interface LogMessage extends BaseMessage {
  role: 'log';
  messageId: string;
  type?: 'tool' | 'unknown';
}

export interface CommandLogMessage extends BaseMessage {
  role: 'command';
  messageId: string;
  command: string;
  cwd: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  retryAttemptIndex?: number;
}

export interface SystemMessage extends BaseMessage {
  role: 'system';
  event: 'cron' | 'policy_approved' | 'policy_rejected' | 'subagent_update' | 'router' | 'other';
  messageId?: string;
  /**
   * Populated on `event === 'cron'` with the CronJob id that fired. Used by
   * adapters (gchat `visibility.jobs: 'header'`) to render a terse header
   * instead of the agent-facing prompt.
   */
  jobId?: string;
}

export interface ToolMessage extends BaseMessage {
  role: 'tool';
  messageId: string;
  name: string;
  payload: unknown;
}

export interface PolicyRequestMessage extends BaseMessage {
  role: 'policy';
  messageId: string;
  requestId: string;
  commandName: string;
  args: string[];
  status: 'pending' | 'approved' | 'rejected';
}

export interface SubagentStatusMessage extends BaseMessage {
  role: 'subagent_status';
  subagentId: string;
  status: 'completed' | 'failed';
  turnId?: string;
}

export interface LegacyLogMessage extends BaseMessage {
  role: 'legacy_log';
  messageId?: string;
  source?: string;
  files?: string[];
  level?: 'default' | 'debug' | 'verbose';
  command?: string;
  cwd?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}

export type ChatMessage =
  | UserMessage
  | AgentReplyMessage
  | CommandLogMessage
  | SystemMessage
  | ToolMessage
  | PolicyRequestMessage
  | SubagentStatusMessage
  | LegacyLogMessage;

export async function getChatsDir(startDir = process.cwd()): Promise<string> {
  const dir = path.join(getClawminiDir(startDir), 'chats');
  if (!existsSync(dir)) {
    await fs.mkdir(dir, { recursive: true });
  }
  return dir;
}

export function isValidChatId(chatId: string): boolean {
  if (!chatId || chatId.length === 0) return false;
  return /^[a-zA-Z0-9_-]+$/.test(chatId);
}

function assertValidChatId(id: string): void {
  if (!isValidChatId(id)) {
    throw new Error(`Invalid chat ID: ${id}`);
  }
}

export async function createChat(id: string, startDir = process.cwd()): Promise<void> {
  assertValidChatId(id);
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
  assertValidChatId(id);
  const chatsDir = await getChatsDir(startDir);
  const chatDir = path.join(chatsDir, id);

  if (!pathIsInsideDir(chatDir, chatsDir)) {
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
  assertValidChatId(id);
  const chatsDir = await getChatsDir(startDir);
  const chatDir = path.join(chatsDir, id);
  if (!existsSync(chatDir)) {
    await createChat(id, startDir);
  }
  const chatFile = path.join(chatDir, 'chat.jsonl');
  await fs.appendFile(chatFile, JSON.stringify(message) + '\n');
}

async function* readLinesBackwards(filePath: string): AsyncGenerator<string, void, unknown> {
  const fd = await fs.open(filePath, 'r');
  try {
    const stats = await fd.stat();
    if (stats.size === 0) return;

    const chunkSize = 64 * 1024;
    let position = stats.size;
    const buffer = Buffer.alloc(chunkSize);
    let leftoverBuffer = Buffer.alloc(0);

    while (position > 0) {
      const readSize = Math.min(chunkSize, position);
      position -= readSize;

      const { bytesRead } = await fd.read(buffer, 0, readSize, position);

      const currentChunk = buffer.subarray(0, bytesRead);
      let combinedBuffer = Buffer.concat([currentChunk, leftoverBuffer]);

      let lastNewlineIdx = combinedBuffer.lastIndexOf(0x0a);

      while (lastNewlineIdx !== -1) {
        const lineBuffer = combinedBuffer.subarray(lastNewlineIdx + 1);
        const line = lineBuffer.toString('utf8').trim();

        if (line) {
          yield line;
        }

        combinedBuffer = combinedBuffer.subarray(0, lastNewlineIdx);
        lastNewlineIdx = combinedBuffer.lastIndexOf(0x0a);
      }
      leftoverBuffer = combinedBuffer;
    }

    if (leftoverBuffer.length > 0) {
      const line = leftoverBuffer.toString('utf8').trim();
      if (line) {
        yield line;
      }
    }
  } finally {
    await fd.close();
  }
}

export function parseChatMessage(line: string): ChatMessage | null {
  try {
    const msg = JSON.parse(line);
    if (msg && msg.role === 'log') {
      msg.role = 'legacy_log';
    }
    return msg as ChatMessage;
  } catch {
    return null;
  }
}

export async function getMessages(
  id: string,
  limit?: number,
  startDir = process.cwd(),
  predicate?: (msg: ChatMessage) => boolean,
  before?: string
): Promise<ChatMessage[]> {
  assertValidChatId(id);
  const chatsDir = await getChatsDir(startDir);
  const chatFile = path.join(chatsDir, id, 'chat.jsonl');
  if (!existsSync(chatFile)) {
    throw new Error(`Chat directory or file for '${id}' not found.`);
  }

  limit = limit ?? 100;

  if (limit <= 0) {
    const content = await fs.readFile(chatFile, 'utf8');
    const lines = content.split('\n').filter((line) => line.trim() !== '');

    let messages = lines
      .map((line) => parseChatMessage(line))
      .filter((msg): msg is ChatMessage => msg !== null);

    if (before) {
      const beforeIndex = messages.findIndex((m) => m.id === before);
      if (beforeIndex !== -1) {
        messages = messages.slice(0, beforeIndex);
      } else {
        messages = [];
      }
    }

    if (predicate) {
      messages = messages.filter(predicate);
    }

    return messages;
  }

  // We have a limit > 0, read backwards to avoid parsing the whole file
  const messages: ChatMessage[] = [];
  let skipping = before !== undefined;

  for await (const line of readLinesBackwards(chatFile)) {
    try {
      const msg = parseChatMessage(line);
      if (!msg) continue;

      if (skipping) {
        if (msg.id === before) {
          skipping = false;
        }
        continue;
      }

      if (!predicate || predicate(msg)) {
        messages.push(msg);
        if (messages.length >= limit) {
          break;
        }
      }
    } catch {
      // Ignore invalid JSON lines
    }
  }

  return messages.reverse();
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
  assertValidChatId(id);
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

export async function findLastMessage(
  id: string,
  predicate: (msg: ChatMessage) => boolean,
  startDir = process.cwd()
): Promise<ChatMessage | null> {
  assertValidChatId(id);
  const chatsDir = await getChatsDir(startDir);
  const chatFile = path.join(chatsDir, id, 'chat.jsonl');
  if (!existsSync(chatFile)) {
    return null;
  }

  for await (const line of readLinesBackwards(chatFile)) {
    try {
      const msg = parseChatMessage(line);
      if (!msg) continue;
      if (predicate(msg)) return msg;
    } catch {
      // Ignore invalid JSON lines
    }
  }

  return null;
}
