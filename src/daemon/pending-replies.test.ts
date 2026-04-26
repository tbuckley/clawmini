import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  enqueuePendingReply,
  readAndClearPendingReplies,
  getPendingRepliesPath,
  drainPendingReplies,
} from './pending-replies.js';

describe('pending-replies queue', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clawmini-pending-'));
    fs.mkdirSync(path.join(tmp, '.clawmini'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('returns empty list when file does not exist', () => {
    expect(readAndClearPendingReplies(tmp)).toEqual([]);
  });

  it('round-trips entries and clears the file on read', () => {
    enqueuePendingReply({ chatId: 'chat-1', kind: 'restart-complete' }, tmp);
    enqueuePendingReply({ chatId: 'chat-2', kind: 'upgrade-complete', messageId: 'msg-x' }, tmp);

    expect(fs.existsSync(getPendingRepliesPath(tmp))).toBe(true);

    const drained = readAndClearPendingReplies(tmp);
    expect(drained).toEqual([
      { chatId: 'chat-1', kind: 'restart-complete' },
      { chatId: 'chat-2', kind: 'upgrade-complete', messageId: 'msg-x' },
    ]);
    expect(fs.existsSync(getPendingRepliesPath(tmp))).toBe(false);
  });

  it('treats a corrupt file as empty and removes it', () => {
    fs.writeFileSync(getPendingRepliesPath(tmp), 'not json');
    expect(readAndClearPendingReplies(tmp)).toEqual([]);
    expect(fs.existsSync(getPendingRepliesPath(tmp))).toBe(false);
  });

  it('drainPendingReplies appends a SystemMessage for each entry', async () => {
    enqueuePendingReply({ chatId: 'default', kind: 'restart-complete' }, tmp);
    enqueuePendingReply({ chatId: 'default', kind: 'upgrade-complete' }, tmp);

    await drainPendingReplies('1.2.3', tmp);

    const chatLog = path.join(tmp, '.clawmini', 'chats', 'default', 'chat.jsonl');
    expect(fs.existsSync(chatLog)).toBe(true);
    const lines = fs
      .readFileSync(chatLog, 'utf-8')
      .split('\n')
      .filter((l) => l.trim());
    expect(lines.length).toBe(2);
    const parsed = lines.map((l) => JSON.parse(l) as { role: string; content: string });
    expect(parsed).toHaveLength(2);
    const [first, second] = parsed as [
      { role: string; content: string },
      { role: string; content: string },
    ];
    expect(first.role).toBe('system');
    expect(first.content).toBe('Clawmini restarted (v1.2.3).');
    expect(second.content).toBe('Clawmini upgraded to v1.2.3.');
    expect(fs.existsSync(getPendingRepliesPath(tmp))).toBe(false);
  });
});
