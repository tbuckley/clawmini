import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';
import {
  createChat,
  listChats,
  deleteChat,
  appendMessage,
  getMessages,
  getDefaultChatId,
  setDefaultChatId,
  type UserMessage,
  type CommandLogMessage,
} from './chats.js';

const TEST_DIR = path.join(process.cwd(), '.clawmini_test_chats');

describe('chats utilities', () => {
  beforeEach(async () => {
    if (existsSync(TEST_DIR)) {
      await fs.rm(TEST_DIR, { recursive: true, force: true });
    }
    await fs.mkdir(path.join(TEST_DIR, '.clawmini'), { recursive: true });
  });

  afterEach(async () => {
    if (existsSync(TEST_DIR)) {
      await fs.rm(TEST_DIR, { recursive: true, force: true });
    }
  });

  it('should create and list chats', async () => {
    await createChat('chat1', TEST_DIR);
    await createChat('chat2', TEST_DIR);

    const chats = await listChats(TEST_DIR);
    expect(chats).toContain('chat1');
    expect(chats).toContain('chat2');
    expect(chats.length).toBe(2);
  });

  it('should delete a chat', async () => {
    await createChat('chat1', TEST_DIR);
    let chats = await listChats(TEST_DIR);
    expect(chats).toContain('chat1');

    await deleteChat('chat1', TEST_DIR);
    chats = await listChats(TEST_DIR);
    expect(chats).not.toContain('chat1');
  });

  it('should append and get messages in JSONL format', async () => {
    await createChat('chat1', TEST_DIR);

    const msg1: UserMessage = {
      id: 'msg-1',
      role: 'user',
      content: 'Hello',
      timestamp: new Date().toISOString(),
    };

    const msg2: CommandLogMessage = {
      id: 'log-1',
      messageId: 'msg-1',
      role: 'log',
      content: 'output',
      stderr: '',
      timestamp: new Date().toISOString(),
      command: 'echo output',
      cwd: '/tmp',
      exitCode: 0,
    };

    const msg3: CommandLogMessage = {
      id: 'log-2',
      messageId: 'msg-1',
      role: 'log',
      source: 'router',
      content: 'router modified message',
      stderr: '',
      timestamp: new Date().toISOString(),
      command: 'router',
      cwd: '/tmp',
      exitCode: 0,
    };

    await appendMessage('chat1', msg1, TEST_DIR);
    await appendMessage('chat1', msg2, TEST_DIR);
    await appendMessage('chat1', msg3, TEST_DIR);

    const messages = await getMessages('chat1', undefined, TEST_DIR);
    expect(messages.length).toBe(3);
    expect(messages[0]).toEqual(msg1);
    expect(messages[1]).toEqual(msg2);
    expect(messages[2]).toEqual(msg3);

    // Test limit
    const limited = await getMessages('chat1', 1, TEST_DIR);
    expect(limited.length).toBe(1);
    expect(limited[0]).toEqual(msg3);
  });

  it('should manage default chat id in settings.json', async () => {
    let defaultId = await getDefaultChatId(TEST_DIR);
    expect(defaultId).toBe('default'); // fallback

    await setDefaultChatId('my-chat', TEST_DIR);
    defaultId = await getDefaultChatId(TEST_DIR);
    expect(defaultId).toBe('my-chat');
  });
});
