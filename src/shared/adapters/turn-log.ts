import type { ChatMessage } from '../chats.js';

export interface TurnLogEntry {
  timestamp: string;
  kind: 'tool' | 'subagent' | 'policy' | 'system' | 'command';
  summary: string;
  rawLength: number;
  subagentId?: string;
  messageRole: string;
}

export interface FormatOpts {
  maxToolPreview?: number;
}

export type CondenseStrategy = 'rollover' | 'drop-earliest' | 'aggressive-truncate' | 'hybrid';

export interface CondenseOpts {
  maxChars: number;
  strategy?: CondenseStrategy;
}

export type CondenseResult =
  | { kind: 'fits'; text: string }
  | { kind: 'rollover'; finalText: string; carryEntries: TurnLogEntry[] };

const DEFAULT_MAX_TOOL_PREVIEW = 400;
const TRUNCATED_SUFFIX = '…[truncated]';
const ROLLOVER_MARKER = '• …log continues';
const DROPPED_MARKER = (n: number) => `• …${n} earlier entries dropped`;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function formatTimestamp(iso: string): string {
  const d = iso ? new Date(iso) : new Date();
  const valid = !Number.isNaN(d.getTime()) ? d : new Date();
  return `${pad2(valid.getHours())}:${pad2(valid.getMinutes())}:${pad2(valid.getSeconds())}`;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const budget = Math.max(0, max - TRUNCATED_SUFFIX.length);
  return s.slice(0, budget) + TRUNCATED_SUFFIX;
}

function sanitize(s: string): string {
  return s.replace(/\s*\r?\n\s*/g, ' ').trim();
}

function renderKind(entry: TurnLogEntry): string {
  return `• ${entry.timestamp}  ${entry.kind}: ${entry.summary}`;
}

export function formatTurnLogEntry(
  message: ChatMessage,
  opts: FormatOpts = {}
): TurnLogEntry | null {
  const maxToolPreview = opts.maxToolPreview ?? DEFAULT_MAX_TOOL_PREVIEW;
  const timestamp = formatTimestamp(message.timestamp);

  if (message.role === 'user' || message.role === 'agent') {
    return null;
  }

  if (message.role === 'tool') {
    const nameSuffix = sanitize(message.content);
    const rawLength = nameSuffix.length;
    const preview = truncate(nameSuffix, maxToolPreview);
    const summary = preview ? `${message.name}(${preview})` : message.name;
    const entry: TurnLogEntry = {
      timestamp,
      kind: 'tool',
      summary,
      rawLength,
      messageRole: message.role,
    };
    if (message.subagentId) entry.subagentId = message.subagentId;
    return entry;
  }

  if (message.role === 'subagent_status') {
    const summary = `${message.subagentId} ${message.status}`;
    const entry: TurnLogEntry = {
      timestamp,
      kind: 'subagent',
      summary,
      rawLength: summary.length,
      messageRole: message.role,
      subagentId: message.subagentId,
    };
    return entry;
  }

  if (message.role === 'policy') {
    const summary = `${message.status} ${message.commandName} ${message.args.join(' ')}`.trim();
    const entry: TurnLogEntry = {
      timestamp,
      kind: 'policy',
      summary: truncate(sanitize(summary), maxToolPreview),
      rawLength: summary.length,
      messageRole: message.role,
    };
    if (message.subagentId) entry.subagentId = message.subagentId;
    return entry;
  }

  if (message.role === 'system') {
    const content = sanitize(message.content || message.event || '');
    const summary = `${message.event}${content ? ': ' + content : ''}`;
    const entry: TurnLogEntry = {
      timestamp,
      kind: 'system',
      summary: truncate(summary, maxToolPreview),
      rawLength: summary.length,
      messageRole: message.role,
    };
    if (message.subagentId) entry.subagentId = message.subagentId;
    return entry;
  }

  if (message.role === 'command') {
    const cmd = sanitize(message.command || message.content || '');
    const entry: TurnLogEntry = {
      timestamp,
      kind: 'command',
      summary: truncate(cmd, maxToolPreview),
      rawLength: cmd.length,
      messageRole: message.role,
    };
    if (message.subagentId) entry.subagentId = message.subagentId;
    return entry;
  }

  if (message.role === 'legacy_log') {
    const content = sanitize(message.content);
    const entry: TurnLogEntry = {
      timestamp,
      kind: 'system',
      summary: truncate(content, maxToolPreview),
      rawLength: content.length,
      messageRole: message.role,
    };
    if (message.subagentId) entry.subagentId = message.subagentId;
    return entry;
  }

  return null;
}

function joinLines(entries: TurnLogEntry[]): string {
  return entries.map(renderKind).join('\n');
}

function reTruncateSummary(entry: TurnLogEntry, cap: number): TurnLogEntry {
  if (entry.summary.length <= cap) return entry;
  return { ...entry, summary: truncate(entry.summary, cap) };
}

function fitRollover(entries: TurnLogEntry[], maxChars: number): CondenseResult {
  const fullText = joinLines(entries);
  if (fullText.length <= maxChars) return { kind: 'fits', text: fullText };

  const markerReserve = ROLLOVER_MARKER.length + 1;
  const budget = Math.max(0, maxChars - markerReserve);

  const kept: TurnLogEntry[] = [];
  let runningLength = 0;
  for (let i = 0; i < entries.length; i++) {
    const line = renderKind(entries[i]!);
    const next = runningLength === 0 ? line.length : runningLength + 1 + line.length;
    if (next > budget) {
      const carryEntries = entries.slice(i);
      if (kept.length === 0) {
        // Single entry too large for one message — emit just the marker and carry all.
        return {
          kind: 'rollover',
          finalText: ROLLOVER_MARKER,
          carryEntries,
        };
      }
      const finalText = `${joinLines(kept)}\n${ROLLOVER_MARKER}`;
      return { kind: 'rollover', finalText, carryEntries };
    }
    runningLength = next;
    kept.push(entries[i]!);
  }

  // Should not reach here; fallback.
  return { kind: 'fits', text: fullText };
}

function fitDropEarliest(entries: TurnLogEntry[], maxChars: number): CondenseResult {
  const fullText = joinLines(entries);
  if (fullText.length <= maxChars) return { kind: 'fits', text: fullText };

  const kept: TurnLogEntry[] = [];
  let dropped = 0;
  let runningLength = 0;

  for (let i = entries.length - 1; i >= 0; i--) {
    const line = renderKind(entries[i]!);
    const marker = DROPPED_MARKER(dropped + i);
    const reserve = i > 0 ? marker.length + 1 : 0;
    const next =
      runningLength === 0 ? line.length + reserve : runningLength + 1 + line.length + reserve;
    if (next > maxChars) {
      dropped = i + 1;
      break;
    }
    kept.unshift(entries[i]!);
    runningLength = runningLength === 0 ? line.length : runningLength + 1 + line.length;
  }

  if (dropped === 0) return { kind: 'fits', text: joinLines(kept) };

  const marker = DROPPED_MARKER(dropped);
  const text = `${marker}\n${joinLines(kept)}`;
  if (text.length <= maxChars) return { kind: 'fits', text };

  // Keep shrinking from the top until it fits.
  while (kept.length > 0) {
    kept.shift();
    dropped++;
    const candidate = `${DROPPED_MARKER(dropped)}\n${joinLines(kept)}`;
    if (candidate.length <= maxChars) return { kind: 'fits', text: candidate };
  }
  return { kind: 'fits', text: DROPPED_MARKER(dropped) };
}

function fitAggressiveTruncate(entries: TurnLogEntry[], maxChars: number): CondenseResult {
  const caps = [400, 200, 100, 50, 20];
  let current = entries;
  for (const cap of caps) {
    current = current.map((e) => reTruncateSummary(e, cap));
    const text = joinLines(current);
    if (text.length <= maxChars) return { kind: 'fits', text };
  }
  const finalText = joinLines(current);
  // Couldn't fit — truncate hard.
  if (finalText.length <= maxChars) return { kind: 'fits', text: finalText };
  return { kind: 'fits', text: truncate(finalText, maxChars) };
}

function fitHybrid(entries: TurnLogEntry[], maxChars: number): CondenseResult {
  const caps = [400, 200, 100, 50, 20];
  let current = entries;
  for (const cap of caps) {
    current = current.map((e) => reTruncateSummary(e, cap));
    const text = joinLines(current);
    if (text.length <= maxChars) return { kind: 'fits', text };
  }
  return fitDropEarliest(current, maxChars);
}

export function condenseTurnLog(
  entries: readonly TurnLogEntry[],
  opts: CondenseOpts
): CondenseResult {
  const strategy: CondenseStrategy = opts.strategy ?? 'rollover';
  const snapshot = entries.slice();
  if (snapshot.length === 0) return { kind: 'fits', text: '' };

  switch (strategy) {
    case 'rollover':
      return fitRollover(snapshot, opts.maxChars);
    case 'drop-earliest':
      return fitDropEarliest(snapshot, opts.maxChars);
    case 'aggressive-truncate':
      return fitAggressiveTruncate(snapshot, opts.maxChars);
    case 'hybrid':
      return fitHybrid(snapshot, opts.maxChars);
  }
}
