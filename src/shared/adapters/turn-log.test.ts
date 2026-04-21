import { describe, it, expect } from 'vitest';
import { formatTurnLogEntry, condenseTurnLog, type TurnLogEntry } from './turn-log.js';
import type {
  AgentReplyMessage,
  CommandLogMessage,
  PolicyRequestMessage,
  SubagentStatusMessage,
  SystemMessage,
  ToolMessage,
  UserMessage,
} from '../chats.js';

const FIXED_TS = '2026-04-20T12:04:02.000Z';

function makeTool(overrides: Partial<ToolMessage> = {}): ToolMessage {
  return {
    id: 'id',
    role: 'tool',
    content: '',
    timestamp: FIXED_TS,
    sessionId: 's',
    messageId: 'mid',
    name: 'Read',
    payload: {},
    ...overrides,
  };
}

describe('formatTurnLogEntry', () => {
  it('returns null for UserMessage / AgentReplyMessage', () => {
    const user: UserMessage = {
      id: '1',
      role: 'user',
      content: 'hi',
      timestamp: FIXED_TS,
      sessionId: 's',
    };
    const reply: AgentReplyMessage = {
      id: '2',
      role: 'agent',
      content: 'hi back',
      timestamp: FIXED_TS,
      sessionId: 's',
    };
    expect(formatTurnLogEntry(user)).toBeNull();
    expect(formatTurnLogEntry(reply)).toBeNull();
  });

  it('formats a ToolMessage', () => {
    const msg = makeTool({ name: 'Read', content: 'src/app.ts' });
    const entry = formatTurnLogEntry(msg);
    expect(entry).not.toBeNull();
    expect(entry!.kind).toBe('tool');
    expect(entry!.summary).toContain('Read');
    expect(entry!.summary).toContain('src/app.ts');
  });

  it('formats a SubagentStatusMessage', () => {
    const msg: SubagentStatusMessage = {
      id: '1',
      role: 'subagent_status',
      content: 'done',
      timestamp: FIXED_TS,
      sessionId: 's',
      subagentId: 'sub-1',
      status: 'completed',
    };
    const entry = formatTurnLogEntry(msg);
    expect(entry).not.toBeNull();
    expect(entry!.kind).toBe('subagent');
    expect(entry!.summary).toContain('sub-1');
    expect(entry!.summary).toContain('completed');
  });

  it('formats a PolicyRequestMessage', () => {
    const msg: PolicyRequestMessage = {
      id: '1',
      role: 'policy',
      content: '',
      timestamp: FIXED_TS,
      sessionId: 's',
      messageId: 'mid',
      requestId: 'req',
      commandName: 'rm',
      args: ['-rf', '/tmp/cache'],
      status: 'approved',
    };
    const entry = formatTurnLogEntry(msg);
    expect(entry!.kind).toBe('policy');
    expect(entry!.summary).toContain('approved');
    expect(entry!.summary).toContain('rm');
  });

  it('formats a CommandLogMessage', () => {
    const msg: CommandLogMessage = {
      id: '1',
      role: 'command',
      content: '',
      timestamp: FIXED_TS,
      sessionId: 's',
      messageId: 'mid',
      command: 'echo hi',
      cwd: '/tmp',
      stdout: '',
      stderr: '',
      exitCode: 0,
    };
    expect(formatTurnLogEntry(msg)!.kind).toBe('command');
  });

  it('formats a SystemMessage', () => {
    const msg: SystemMessage = {
      id: '1',
      role: 'system',
      content: 'stuff',
      timestamp: FIXED_TS,
      sessionId: 's',
      event: 'subagent_update',
    };
    const entry = formatTurnLogEntry(msg);
    expect(entry!.kind).toBe('system');
    expect(entry!.summary).toContain('subagent_update');
  });

  it('truncates tool content longer than maxToolPreview', () => {
    const msg = makeTool({ content: 'x'.repeat(500) });
    const entry = formatTurnLogEntry(msg, { maxToolPreview: 100 })!;
    expect(entry.summary).toContain('[truncated]');
    // The tool name + parens + content preview should not massively exceed cap.
    expect(entry.summary.length).toBeLessThanOrEqual(200);
    expect(entry.rawLength).toBe(500);
  });

  it('replaces newlines in tool content with spaces', () => {
    const msg = makeTool({ content: 'line1\nline2\nline3' });
    const entry = formatTurnLogEntry(msg)!;
    expect(entry.summary).not.toContain('\n');
    expect(entry.summary).toContain('line1');
    expect(entry.summary).toContain('line3');
  });
});

function mkEntry(summary: string, overrides: Partial<TurnLogEntry> = {}): TurnLogEntry {
  return {
    timestamp: '12:04:02',
    kind: 'tool',
    summary,
    rawLength: summary.length,
    messageRole: 'tool',
    ...overrides,
  };
}

describe('condenseTurnLog', () => {
  it('rollover strategy: fits when under budget', () => {
    const entries = [mkEntry('Read(small)'), mkEntry('Grep(small)')];
    const result = condenseTurnLog(entries, { maxChars: 500, strategy: 'rollover' });
    expect(result.kind).toBe('fits');
    if (result.kind === 'fits') {
      expect(result.text).toContain('Read');
      expect(result.text).toContain('Grep');
    }
  });

  it('rollover strategy: rolls over when exceeded', () => {
    const entries = Array.from({ length: 20 }, (_, i) => mkEntry('X'.repeat(40) + ` #${i}`));
    const result = condenseTurnLog(entries, { maxChars: 200, strategy: 'rollover' });
    expect(result.kind).toBe('rollover');
    if (result.kind === 'rollover') {
      expect(result.finalText).toContain('…log continues');
      expect(result.carryEntries.length).toBeGreaterThan(0);
      expect(result.carryEntries.length).toBeLessThan(entries.length);
    }
  });

  it('drop-earliest strategy: drops oldest entries and prepends a count marker', () => {
    const entries = Array.from({ length: 10 }, (_, i) => mkEntry(`entry-${i}`));
    const result = condenseTurnLog(entries, { maxChars: 100, strategy: 'drop-earliest' });
    expect(result.kind).toBe('fits');
    if (result.kind === 'fits') {
      expect(result.text).toMatch(/• …\d+ earlier entries dropped/);
      expect(result.text).toContain(`entry-${entries.length - 1}`);
      expect(result.text).not.toContain('entry-0');
    }
  });

  it('aggressive-truncate strategy: shortens per-entry summaries to fit', () => {
    const entries = Array.from({ length: 5 }, (_, i) =>
      mkEntry('Y'.repeat(300) + ` #${i}`, { rawLength: 305 })
    );
    const result = condenseTurnLog(entries, { maxChars: 300, strategy: 'aggressive-truncate' });
    expect(result.kind).toBe('fits');
    if (result.kind === 'fits') {
      const lines = result.text.split('\n').filter(Boolean);
      expect(lines.length).toBe(5);
      expect(result.text.length).toBeLessThanOrEqual(300);
    }
  });

  it('hybrid strategy: truncates first, then drops earliest if still over budget', () => {
    const entries = Array.from({ length: 30 }, (_, i) =>
      mkEntry('Z'.repeat(100) + ` #${i}`, { rawLength: 105 })
    );
    const result = condenseTurnLog(entries, { maxChars: 150, strategy: 'hybrid' });
    expect(result.kind).toBe('fits');
    if (result.kind === 'fits') {
      expect(result.text).toContain('entries dropped');
      expect(result.text.length).toBeLessThanOrEqual(150);
    }
  });

  it('is pure — does not mutate input', () => {
    const entries = [mkEntry('one'), mkEntry('two')];
    const copy = entries.map((e) => ({ ...e }));
    const r1 = condenseTurnLog(entries, { maxChars: 500, strategy: 'rollover' });
    const r2 = condenseTurnLog(entries, { maxChars: 500, strategy: 'rollover' });
    expect(r1).toEqual(r2);
    expect(entries).toEqual(copy);
  });
});
