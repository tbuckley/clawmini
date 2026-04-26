import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { getClawminiDir } from '../shared/workspace.js';
import type { SystemMessage } from '../shared/chats.js';
import { appendMessage } from './chats.js';

export type PendingReplyKind = 'restart-complete' | 'upgrade-complete';

export interface PendingReply {
  chatId: string;
  kind: PendingReplyKind;
  /** Original user messageId, recorded so the SystemMessage can reference it. */
  messageId?: string;
}

interface PendingRepliesFile {
  version: 1;
  entries: PendingReply[];
}

export function getPendingRepliesPath(startDir = process.cwd()): string {
  return path.join(getClawminiDir(startDir), 'pending-replies.json');
}

function readFileSafe(filePath: string): PendingRepliesFile | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as PendingRepliesFile;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.entries)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function enqueuePendingReply(entry: PendingReply, startDir = process.cwd()): void {
  const filePath = getPendingRepliesPath(startDir);
  const existing = readFileSafe(filePath);
  const entries = existing?.entries ?? [];
  entries.push(entry);
  const next: PendingRepliesFile = { version: 1, entries };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(next, null, 2));
}

export function readAndClearPendingReplies(startDir = process.cwd()): PendingReply[] {
  const filePath = getPendingRepliesPath(startDir);
  const data = readFileSafe(filePath);
  if (!data) {
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch {
        // best-effort
      }
    }
    return [];
  }
  try {
    fs.unlinkSync(filePath);
  } catch {
    // best-effort: even if unlink fails, don't double-deliver — overwrite empty.
    try {
      fs.writeFileSync(filePath, JSON.stringify({ version: 1, entries: [] }, null, 2));
    } catch {
      // give up
    }
  }
  return data.entries;
}

function renderMessage(kind: PendingReplyKind, version: string): string {
  switch (kind) {
    case 'restart-complete':
      return `Clawmini restarted (v${version}).`;
    case 'upgrade-complete':
      return `Clawmini upgraded to v${version}.`;
  }
}

/**
 * Append a SystemMessage for each pending reply. Called from the daemon
 * startup path so adapters (which preserve their per-chat cursor across the
 * restart) deliver the message after the daemon comes back online.
 */
export async function drainPendingReplies(
  version: string,
  startDir = process.cwd()
): Promise<void> {
  const entries = readAndClearPendingReplies(startDir);
  for (const entry of entries) {
    const sysMsg: SystemMessage = {
      id: randomUUID(),
      role: 'system',
      content: renderMessage(entry.kind, version),
      timestamp: new Date().toISOString(),
      sessionId: undefined,
      event: 'router',
      displayRole: 'agent',
      ...(entry.messageId ? { messageId: entry.messageId } : {}),
    };
    try {
      await appendMessage(entry.chatId, sysMsg, startDir);
    } catch (err) {
      console.error(
        `Failed to deliver pending reply to chat ${entry.chatId}:`,
        err instanceof Error ? err.message : err
      );
    }
  }
}
