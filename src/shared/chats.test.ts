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
      role: 'command',
      content: 'output',
      stderr: '',
      stdout: '',
      timestamp: new Date().toISOString(),
      command: 'echo output',
      cwd: '/tmp',
      exitCode: 0,
    };

    const msg3: CommandLogMessage = {
      id: 'log-2',
      messageId: 'msg-1',
      role: 'command',
      content: 'router modified message',
      stderr: '',
      stdout: '',
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

    // Test predicate filtering combined with limit
    const msgSub = { ...msg2, id: 'sub-1', subagentId: 'sub-123' };
    await appendMessage('chat1', msgSub as CommandLogMessage, TEST_DIR);

    // Total is now 4 messages (3 normal, 1 subagent)
    const withPredicate = await getMessages('chat1', 2, TEST_DIR, (m) => !m.subagentId);
    expect(withPredicate.length).toBe(2);
    expect(withPredicate[0]).toEqual(msg2);
    expect(withPredicate[1]).toEqual(msg3);
  });

  it('should manage default chat id in settings.json', async () => {
    let defaultId = await getDefaultChatId(TEST_DIR);
    expect(defaultId).toBe('default'); // fallback

    await setDefaultChatId('my-chat', TEST_DIR);
    defaultId = await getDefaultChatId(TEST_DIR);
    expect(defaultId).toBe('my-chat');
  });

  it('should support message pagination with before cursor and limits', async () => {
    await createChat('chat1', TEST_DIR);

    const msgs: UserMessage[] = Array.from({ length: 5 }, (_, i) => ({
      id: `msg-${i + 1}`,
      role: 'user',
      content: `Message ${i + 1}`,
      timestamp: new Date().toISOString(),
    }));

    for (const msg of msgs) {
      await appendMessage('chat1', msg, TEST_DIR);
    }

    // Default limit should be 100, which returns all 5
    const all = await getMessages('chat1', undefined, TEST_DIR);
    expect(all.length).toBe(5);

    // Limit to 2 should return the last 2
    const lastTwo = await getMessages('chat1', 2, TEST_DIR);
    expect(lastTwo.length).toBe(2);
    expect(lastTwo[0]?.id).toBe('msg-4');
    expect(lastTwo[1]?.id).toBe('msg-5');

    // Before cursor with limit
    const beforeCursor = await getMessages('chat1', 2, TEST_DIR, undefined, 'msg-4');
    expect(beforeCursor.length).toBe(2);
    expect(beforeCursor[0]?.id).toBe('msg-2');
    expect(beforeCursor[1]?.id).toBe('msg-3');

    // Before cursor reaching the start
    const beforeCursorStart = await getMessages('chat1', 2, TEST_DIR, undefined, 'msg-2');
    expect(beforeCursorStart.length).toBe(1);
    expect(beforeCursorStart[0]?.id).toBe('msg-1');

    // Before cursor that doesn't exist returns empty
    const beforeCursorUnknown = await getMessages('chat1', 2, TEST_DIR, undefined, 'msg-unknown');
    expect(beforeCursorUnknown.length).toBe(0);

    // Limit 0 or negative should read all (Wait, limit 0 reads all?)
    // Our implementation sets default to 100 if undefined. If 0 is explicitly passed, it hits `limit <= 0` and reads all.
    const readAll = await getMessages('chat1', 0, TEST_DIR);
    expect(readAll.length).toBe(5);

    // Before cursor with limit <= 0
    const readAllBefore = await getMessages('chat1', 0, TEST_DIR, undefined, 'msg-4');
    expect(readAllBefore.length).toBe(3);
    expect(readAllBefore[0]?.id).toBe('msg-1');
  });

  it('should parse legacy log messages gracefully', async () => {
    await createChat('chat1', TEST_DIR);

    // Old plain log missing messageId
    const oldPlainLog = {
      id: 'log-1',
      role: 'log',
      content: 'legacy content',
      timestamp: new Date().toISOString(),
    };

    // Old command log with legacy properties
    const oldCommandLog = {
      id: 'log-2',
      role: 'log',
      messageId: 'msg-1',
      content: 'output',
      command: 'echo output',
      timestamp: new Date().toISOString(),
    };

    // New generic log message without legacy properties
    const newLogMsg = {
      id: 'log-3',
      role: 'log',
      messageId: 'msg-1',
      content: 'new log',
      timestamp: new Date().toISOString(),
      type: 'tool',
    };

    const chatFile = path.join(TEST_DIR, '.clawmini', 'chats', 'chat1', 'chat.jsonl');
    await fs.appendFile(chatFile, JSON.stringify(oldPlainLog) + '\n');
    await fs.appendFile(chatFile, JSON.stringify(oldCommandLog) + '\n');
    await fs.appendFile(chatFile, JSON.stringify(newLogMsg) + '\n');

    const messages = await getMessages('chat1', undefined, TEST_DIR);
    expect(messages.length).toBe(3);

    // Should map to legacy_log
    expect(messages[0]?.role).toBe('legacy_log');
    expect(messages[1]?.role).toBe('legacy_log');

    // Should remain log
    expect(messages[2]?.role).toBe('log');
  });
});
