/* eslint-disable max-lines */
import type { ChatMessage } from '../chats.js';

export interface TurnLogEntry {
  timestamp: string;
  kind: 'tool' | 'subagent' | 'policy' | 'system';
  summary: string;
  rawLength: number;
  subagentId?: string;
  messageRole: string;
}

export interface FormatOpts {
  maxToolPreview?: number;
  /**
   * Reference time for rendering relative timestamps (e.g. `0s`, `1m5s`).
   * When omitted, timestamps fall back to wall-clock `HH:MM:SS`.
   */
  turnStartedAt?: string;
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

function formatRelative(deltaMs: number): string {
  const sec = Math.max(0, Math.floor(deltaMs / 1000));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s === 0 ? `${m}m` : `${m}m${s}s`;
}

function formatTimestamp(iso: string, turnStartedAt?: string): string {
  if (turnStartedAt) {
    const start = new Date(turnStartedAt).getTime();
    const now = iso ? new Date(iso).getTime() : Date.now();
    if (!Number.isNaN(start) && !Number.isNaN(now)) {
      return formatRelative(now - start);
    }
  }
  const d = iso ? new Date(iso) : new Date();
  const valid = !Number.isNaN(d.getTime()) ? d : new Date();
  return `${pad2(valid.getHours())}:${pad2(valid.getMinutes())}:${pad2(valid.getSeconds())}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function shortSubagentId(id: string): string {
  // UUIDs are visual noise; the first hex segment is enough to disambiguate.
  // User-supplied ids (e.g. `hello-sub`) are typically short already.
  return UUID_RE.test(id) ? id.slice(0, 8) : id;
}

interface ToolPrincipal {
  verb: string;
  arg: string;
}

/**
 * Extract a (verb, principal-arg) pair from a tool message so the turn log
 * can render `read: foo.md` instead of `read_file({ "file_path": "foo.md" })`.
 * Unknown tool names fall back to `<name>: <stringified-payload>` so we don't
 * silently lose information.
 */
function extractToolPrincipal(name: string, payload: unknown): ToolPrincipal {
  const p = (payload ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (v == null ? '' : String(v));

  switch (name) {
    case 'read_file':
    case 'Read':
      return { verb: 'read', arg: str(p.file_path ?? p.path) };
    case 'write_file':
    case 'create_file':
    case 'Write':
      return { verb: 'write', arg: str(p.file_path ?? p.path) };
    case 'edit_file':
    case 'Edit':
      return { verb: 'edit', arg: str(p.file_path ?? p.path) };
    case 'run_shell_command':
    case 'shell':
    case 'Bash':
      return { verb: 'shell', arg: str(p.command) };
    case 'activate_skill':
    case 'Skill':
      return { verb: 'skill', arg: str(p.name ?? p.skill) };
    case 'glob':
    case 'Glob':
      return { verb: 'glob', arg: str(p.pattern) };
    case 'grep':
    case 'Grep':
      return { verb: 'grep', arg: str(p.pattern) };
    case 'web_fetch':
    case 'WebFetch':
      return { verb: 'fetch', arg: str(p.url) };
  }

  const arg = payload === undefined || payload === null ? '' : JSON.stringify(payload);
  return { verb: name, arg };
}

function statusSigil(status: 'completed' | 'failed'): string {
  return status === 'completed' ? '✅' : '❌';
}

/** Emoji for messages crossing the subagent boundary. */
const SUBAGENT_TO = '👉';
const SUBAGENT_FROM = '👈';

/**
 * Emoji that stands in for a known tool verb. When present, it replaces the
 * verb word entirely (`🐚 sleep 20` instead of `shell: sleep 20`). Unknown
 * tools fall through to the `<name>: <arg>` form, preserving accessibility.
 */
const VERB_EMOJI: Record<string, string> = {
  read: '📖',
  write: '✍️',
  edit: '✏️',
  shell: '🧑‍💻',
  skill: '📚',
  glob: '📁',
  grep: '🔎',
  fetch: '🌐',
};

const SUBAGENT_MARKER = '🤖';

/** Emoji rendered on the turn's opening entry (posted when the turn starts). */
export const TURN_START_EMOJI = '▶️';

/**
 * Entries produced *inside* a subagent (a tool call, policy, system event
 * with `subagentId` set) need a marker so the reader knows the activity
 * happened inside the delegated turn. Boundary events (prompt, reply, status)
 * already name the subagent via 👉/👈/✅, so they're excluded.
 */
function needsSubagentMarker(entry: TurnLogEntry): boolean {
  if (!entry.subagentId) return false;
  return (
    entry.messageRole !== 'user' &&
    entry.messageRole !== 'agent' &&
    entry.messageRole !== 'subagent_status'
  );
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const budget = Math.max(0, max - TRUNCATED_SUFFIX.length);
  return s.slice(0, budget) + TRUNCATED_SUFFIX;
}

function sanitize(s: string): string {
  return s.replace(/\s*\r?\n\s*/g, ' ').trim();
}

function renderEntry(entry: TurnLogEntry): string {
  const prefix = needsSubagentMarker(entry)
    ? `${SUBAGENT_MARKER} ${shortSubagentId(entry.subagentId!)} `
    : '';
  return `• ${entry.timestamp}  ${prefix}${entry.summary}`;
}

/**
 * Build the first entry posted into a turn's activity log so the thread
 * appears as soon as `turnStarted` fires, rather than waiting for the first
 * real event.
 */
export function buildTurnStartEntry(): TurnLogEntry {
  const summary = `${TURN_START_EMOJI} Started processing…`;
  return {
    timestamp: '0s',
    kind: 'system',
    summary,
    rawLength: summary.length,
    messageRole: 'turn_start',
  };
}

export function formatTurnLogEntry(
  message: ChatMessage,
  opts: FormatOpts = {}
): TurnLogEntry | null {
  const maxToolPreview = opts.maxToolPreview ?? DEFAULT_MAX_TOOL_PREVIEW;
  const timestamp = formatTimestamp(message.timestamp, opts.turnStartedAt);

  if (message.role === 'user' || message.role === 'agent') {
    if (!message.subagentId) return null;
    // Subagent prompts and final replies are part of the parent turn's
    // activity: the prompt shows what the subagent was told to do, the reply
    // shows what it produced. Render them in the log so the reader can follow
    // the orchestration without switching context.
    const direction = message.role === 'user' ? SUBAGENT_TO : SUBAGENT_FROM;
    const content = sanitize(message.content);
    const id = shortSubagentId(message.subagentId);
    const summary = `${direction} ${id}: ${truncate(content, maxToolPreview)}`;
    return {
      timestamp,
      kind: 'subagent',
      summary,
      rawLength: content.length,
      messageRole: message.role,
      subagentId: message.subagentId,
    };
  }

  if (message.role === 'tool') {
    const { verb, arg } = extractToolPrincipal(message.name, message.payload);
    const cleanArg = sanitize(arg);
    const emoji = VERB_EMOJI[verb];
    const argPreview = cleanArg ? truncate(cleanArg, maxToolPreview) : '';
    let summary: string;
    if (emoji) {
      summary = argPreview ? `${emoji} ${argPreview}` : emoji;
    } else {
      summary = argPreview ? `${verb}: ${argPreview}` : verb;
    }
    const entry: TurnLogEntry = {
      timestamp,
      kind: 'tool',
      summary,
      rawLength: cleanArg.length,
      messageRole: message.role,
    };
    if (message.subagentId) entry.subagentId = message.subagentId;
    return entry;
  }

  if (message.role === 'subagent_status') {
    const id = shortSubagentId(message.subagentId);
    const summary = `${statusSigil(message.status)} ${id}`;
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
    const body = `${message.commandName} ${message.args.join(' ')}`.trim();
    const summary = `policy ${message.status}: ${body}`;
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
    // subagent_update is the wake-up signal that re-enters the parent agent
    // after an async subagent completes. Its content is a `<notification>`
    // envelope — internal orchestration the reader doesn't need. The ✅ from
    // subagent_status already conveys completion, and the parent's follow-up
    // reply shows the response.
    if (message.event === 'subagent_update') return null;
    const content = sanitize(message.content || '');
    const summary = content ? `${message.event}: ${content}` : message.event;
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
    // The raw shell command (usually the agent template wrapping
    // $CLAW_CLI_MESSAGE) isn't informative to a reader skimming the log;
    // tool calls and subagent events already describe what the agent did.
    return null;
  }

  if (message.role === 'legacy_log') {
    const content = sanitize(message.content);
    const summary = content ? `log: ${content}` : 'log';
    const entry: TurnLogEntry = {
      timestamp,
      kind: 'system',
      summary: truncate(summary, maxToolPreview),
      rawLength: content.length,
      messageRole: message.role,
    };
    if (message.subagentId) entry.subagentId = message.subagentId;
    return entry;
  }

  return null;
}

function joinLines(entries: TurnLogEntry[]): string {
  return entries.map(renderEntry).join('\n');
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
    const line = renderEntry(entries[i]!);
    const next = runningLength === 0 ? line.length : runningLength + 1 + line.length;
    if (next > budget) {
      if (kept.length === 0) {
        // Single entry's line is larger than the per-message budget: hard-
        // truncate its rendered form so we don't get stuck in a "same carry"
        // rollover loop. The continuation marker is baked into the truncated
        // text rather than appended, so the reader still sees the `…` signal.
        const truncatedLine = truncate(line, maxChars);
        return {
          kind: 'rollover',
          finalText: truncatedLine,
          carryEntries: entries.slice(i + 1),
        };
      }
      const carryEntries = entries.slice(i);
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

  // Reserve enough space for the largest possible marker up-front. The marker's
  // digit count monotonically grows with the number of dropped entries, so
  // `DROPPED_MARKER(entries.length)` is the worst case we'd ever emit. Reserving
  // this fixed amount (whenever there are earlier entries left to drop) removes
  // the off-by-one between the reserved-for and actually-emitted marker widths.
  const maxMarkerLen = DROPPED_MARKER(entries.length).length + 1;

  const kept: TurnLogEntry[] = [];
  let dropped = 0;
  let runningLength = 0;

  for (let i = entries.length - 1; i >= 0; i--) {
    const line = renderEntry(entries[i]!);
    const reserve = i > 0 ? maxMarkerLen : 0;
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
