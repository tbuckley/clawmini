import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { getClawminiDir } from '../shared/workspace.js';
import type { SystemMessage } from '../shared/chats.js';
import { appendMessage } from './chats.js';

export type PendingReplyKind = 'restart-complete' | 'upgrade-complete' | 'upgrade-failed';

export interface PendingReply {
  chatId: string;
  kind: PendingReplyKind;
  /** Original user messageId, recorded so the SystemMessage can reference it. */
  messageId?: string;
  /** Requested target version (set for upgrade-* kinds). */
  requestedVersion?: string;
  /** Failure reason; set for upgrade-failed. */
  reason?: string;
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

function writeAtomic(filePath: string, data: PendingRepliesFile): void {
  // tmp + rename so a crash never leaves a half-written file. The target file
  // is on the same filesystem as the workspace, so rename is atomic.
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
  fs.renameSync(tmpPath, filePath);
}

function tryUnlink(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  try {
    fs.unlinkSync(filePath);
  } catch {
    // best-effort
  }
}

export function enqueuePendingReply(entry: PendingReply, startDir = process.cwd()): void {
  const filePath = getPendingRepliesPath(startDir);
  const existing = readFileSafe(filePath);
  const entries = existing?.entries ?? [];
  entries.push(entry);
  writeAtomic(filePath, { version: 1, entries });
}

/**
 * Remove the first entry that matches the predicate. Used to roll back an
 * enqueued entry when the supervisor reports the action could not be started.
 */
export function dequeuePendingReply(
  predicate: (entry: PendingReply) => boolean,
  startDir = process.cwd()
): boolean {
  const filePath = getPendingRepliesPath(startDir);
  const existing = readFileSafe(filePath);
  if (!existing) return false;
  const idx = existing.entries.findIndex(predicate);
  if (idx === -1) return false;
  existing.entries.splice(idx, 1);
  if (existing.entries.length === 0) {
    tryUnlink(filePath);
  } else {
    writeAtomic(filePath, existing);
  }
  return true;
}

export function readPendingReplies(startDir = process.cwd()): PendingReply[] {
  return readFileSafe(getPendingRepliesPath(startDir))?.entries ?? [];
}

function renderMessage(entry: PendingReply, runtimeVersion: string): string {
  switch (entry.kind) {
    case 'restart-complete':
      return `Clawmini restarted (v${runtimeVersion}).`;
    case 'upgrade-complete':
      return `Clawmini upgraded to v${runtimeVersion}.`;
    case 'upgrade-failed': {
      const target = entry.requestedVersion ? ` to v${entry.requestedVersion}` : '';
      const reason = entry.reason ? `: ${entry.reason}` : '.';
      return `Clawmini upgrade${target} failed${reason}`;
    }
  }
}

/**
 * Append a SystemMessage for each pending reply. Called from the daemon
 * startup path so adapters (which reconnect via tRPC subscription with
 * lastMessageId) replay the message after the daemon comes back online.
 *
 * Crash-safe: each entry is consumed only after its SystemMessage is
 * appended. A crash mid-loop leaves the un-delivered entries on disk for the
 * next daemon start to drain.
 */
export async function drainPendingReplies(
  runtimeVersion: string,
  startDir = process.cwd()
): Promise<void> {
  const filePath = getPendingRepliesPath(startDir);
  const data = readFileSafe(filePath);
  if (!data) {
    // A corrupt file is treated as empty — remove it so it doesn't trip the
    // next read, but otherwise no-op.
    tryUnlink(filePath);
    return;
  }

  const remaining: PendingReply[] = [...data.entries];
  while (remaining.length > 0) {
    const entry = remaining[0]!;
    const sysMsg: SystemMessage = {
      id: randomUUID(),
      role: 'system',
      content: renderMessage(entry, runtimeVersion),
      timestamp: new Date().toISOString(),
      sessionId: undefined,
      event: 'router',
      displayRole: 'agent',
      ...(entry.messageId ? { messageId: entry.messageId } : {}),
    };
    try {
      await appendMessage(entry.chatId, sysMsg, startDir);
    } catch (err) {
      // A delivery failure (e.g. chatId no longer exists) shouldn't block the
      // rest of the queue from draining. Drop the entry after logging — the
      // alternative is an infinite redelivery loop on the next start.
      console.error(
        `Failed to deliver pending reply to chat ${entry.chatId}:`,
        err instanceof Error ? err.message : err
      );
    }
    remaining.shift();
    if (remaining.length === 0) {
      tryUnlink(filePath);
    } else {
      writeAtomic(filePath, { version: 1, entries: remaining });
    }
  }
}
