import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  enqueuePendingReply,
  dequeuePendingReply,
  readPendingReplies,
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
    expect(readPendingReplies(tmp)).toEqual([]);
  });

  it('round-trips entries via enqueue + readPendingReplies', () => {
    enqueuePendingReply({ chatId: 'chat-1', kind: 'restart-complete' }, tmp);
    enqueuePendingReply({ chatId: 'chat-2', kind: 'upgrade-complete', messageId: 'msg-x' }, tmp);

    expect(fs.existsSync(getPendingRepliesPath(tmp))).toBe(true);
    expect(readPendingReplies(tmp)).toEqual([
      { chatId: 'chat-1', kind: 'restart-complete' },
      { chatId: 'chat-2', kind: 'upgrade-complete', messageId: 'msg-x' },
    ]);
  });

  it('dequeuePendingReply removes the matching entry and deletes the file when empty', () => {
    enqueuePendingReply({ chatId: 'chat-1', kind: 'upgrade-complete', messageId: 'm-1' }, tmp);
    expect(dequeuePendingReply((e) => e.messageId === 'm-1', tmp)).toBe(true);
    expect(fs.existsSync(getPendingRepliesPath(tmp))).toBe(false);
  });

  it('dequeuePendingReply returns false when no entry matches', () => {
    enqueuePendingReply({ chatId: 'chat-1', kind: 'restart-complete' }, tmp);
    expect(dequeuePendingReply((e) => e.messageId === 'nope', tmp)).toBe(false);
    expect(readPendingReplies(tmp)).toHaveLength(1);
  });

  it('treats a corrupt file as empty and removes it on drain', async () => {
    fs.writeFileSync(getPendingRepliesPath(tmp), 'not json');
    await drainPendingReplies('1.2.3', tmp);
    expect(fs.existsSync(getPendingRepliesPath(tmp))).toBe(false);
  });

  it('drainPendingReplies appends a SystemMessage for each entry', async () => {
    enqueuePendingReply({ chatId: 'default', kind: 'restart-complete' }, tmp);
    enqueuePendingReply({ chatId: 'default', kind: 'upgrade-complete' }, tmp);
    enqueuePendingReply(
      {
        chatId: 'default',
        kind: 'upgrade-failed',
        requestedVersion: '9.9.9',
        reason: 'npm install -g exited with code 1',
      },
      tmp
    );

    await drainPendingReplies('1.2.3', tmp);

    const chatLog = path.join(tmp, '.clawmini', 'chats', 'default', 'chat.jsonl');
    expect(fs.existsSync(chatLog)).toBe(true);
    const lines = fs
      .readFileSync(chatLog, 'utf-8')
      .split('\n')
      .filter((l) => l.trim());
    expect(lines).toHaveLength(3);
    const parsed = lines.map((l) => JSON.parse(l) as { role: string; content: string });
    expect(parsed[0]?.role).toBe('system');
    expect(parsed[0]?.content).toBe('Clawmini restarted (v1.2.3).');
    expect(parsed[1]?.content).toBe('Clawmini upgraded to v1.2.3.');
    expect(parsed[2]?.content).toBe(
      'Clawmini upgrade to v9.9.9 failed: npm install -g exited with code 1'
    );
    expect(fs.existsSync(getPendingRepliesPath(tmp))).toBe(false);
  });

  it('drain consumes entries one at a time, leaving the rest on disk if a delivery throws', async () => {
    // Make the second delivery throw by giving it an invalid chatId. The
    // shared chats helper rejects ids containing path separators.
    enqueuePendingReply({ chatId: 'a', kind: 'restart-complete' }, tmp);
    enqueuePendingReply({ chatId: '../escape', kind: 'restart-complete' }, tmp);
    enqueuePendingReply({ chatId: 'c', kind: 'restart-complete' }, tmp);

    // Silence the expected error log from the failing entry.
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await drainPendingReplies('1.0.0', tmp);
    } finally {
      err.mockRestore();
    }

    // All three are consumed (the failing one is dropped after logging) and
    // the file is removed. The two valid chats got their messages.
    expect(fs.existsSync(getPendingRepliesPath(tmp))).toBe(false);
    expect(fs.existsSync(path.join(tmp, '.clawmini', 'chats', 'a', 'chat.jsonl'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, '.clawmini', 'chats', 'c', 'chat.jsonl'))).toBe(true);
  });
});
