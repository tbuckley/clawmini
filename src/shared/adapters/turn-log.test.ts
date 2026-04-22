import { describe, it, expect } from 'vitest';
import {
  formatTurnLogEntry,
  condenseTurnLog,
  buildTurnStartEntry,
  TURN_START_EMOJI,
  type TurnLogEntry,
} from './turn-log.js';
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
    payload: { file_path: 'src/app.ts' },
    ...overrides,
  };
}

describe('formatTurnLogEntry', () => {
  it('returns null for top-level UserMessage / AgentReplyMessage', () => {
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

  it('renders a subagent prompt (user role with subagentId) as a subagent entry', () => {
    const msg: UserMessage = {
      id: '1',
      role: 'user',
      content: 'research auth flow',
      timestamp: FIXED_TS,
      sessionId: 's',
      subagentId: 'sub-1',
    };
    const entry = formatTurnLogEntry(msg);
    expect(entry).not.toBeNull();
    expect(entry!.kind).toBe('subagent');
    expect(entry!.summary).toContain('sub-1');
    expect(entry!.summary).toContain('research auth flow');
    expect(entry!.summary).toContain('👉');
  });

  it('renders a subagent reply (agent role with subagentId) as a subagent entry', () => {
    const msg: AgentReplyMessage = {
      id: '2',
      role: 'agent',
      content: 'found 3 callers',
      timestamp: FIXED_TS,
      sessionId: 's',
      subagentId: 'sub-1',
    };
    const entry = formatTurnLogEntry(msg);
    expect(entry).not.toBeNull();
    expect(entry!.kind).toBe('subagent');
    expect(entry!.summary).toContain('sub-1');
    expect(entry!.summary).toContain('found 3 callers');
    expect(entry!.summary).toContain('👈');
  });

  it('formats a ToolMessage with a known extractor (emoji replaces verb)', () => {
    const msg = makeTool({ name: 'Read', payload: { file_path: 'src/app.ts' } });
    const entry = formatTurnLogEntry(msg);
    expect(entry).not.toBeNull();
    expect(entry!.kind).toBe('tool');
    expect(entry!.summary).toBe('📖 src/app.ts');
  });

  it('falls back to <name>: <json> for unknown tools (no emoji)', () => {
    const msg = makeTool({ name: 'mystery_tool', payload: { foo: 1, bar: 'two' } });
    const entry = formatTurnLogEntry(msg)!;
    expect(entry.summary).toContain('mystery_tool');
    expect(entry.summary).toContain('"foo"');
    expect(entry.summary).toContain('"bar"');
  });

  it('uses a verb-specific emoji for common tools', () => {
    expect(
      formatTurnLogEntry(makeTool({ name: 'run_shell_command', payload: { command: 'ls -la' } }))!
        .summary
    ).toBe('🧑‍💻 ls -la');
    expect(
      formatTurnLogEntry(
        makeTool({ name: 'activate_skill', payload: { name: 'clawmini-subagents' } })
      )!.summary
    ).toBe('📚 clawmini-subagents');
    expect(
      formatTurnLogEntry(makeTool({ name: 'Bash', payload: { command: 'echo hi' } }))!.summary
    ).toBe('🧑‍💻 echo hi');
    expect(
      formatTurnLogEntry(makeTool({ name: 'Grep', payload: { pattern: 'TODO' } }))!.summary
    ).toBe('🔎 TODO');
  });

  it('formats a SubagentStatusMessage with a sigil', () => {
    const msg: SubagentStatusMessage = {
      id: '1',
      role: 'subagent_status',
      content: 'done',
      timestamp: FIXED_TS,
      sessionId: 's',
      subagentId: 'sub-1',
      status: 'completed',
    };
    expect(formatTurnLogEntry(msg)!.summary).toBe('✅ sub-1');

    const failed = { ...msg, status: 'failed' as const };
    expect(formatTurnLogEntry(failed)!.summary).toBe('❌ sub-1');
  });

  it('shortens UUID subagent ids but leaves human ids alone', () => {
    const uuid = '5ea7b9ba-5103-40ee-95b6-c90808bbc431';
    const status: SubagentStatusMessage = {
      id: '1',
      role: 'subagent_status',
      content: '',
      timestamp: FIXED_TS,
      sessionId: 's',
      subagentId: uuid,
      status: 'completed',
    };
    expect(formatTurnLogEntry(status)!.summary).toBe('✅ 5ea7b9ba');

    const human = { ...status, subagentId: 'hello-sub' };
    expect(formatTurnLogEntry(human)!.summary).toBe('✅ hello-sub');
  });

  it('formats a PolicyRequestMessage with a status verb', () => {
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
    const entry = formatTurnLogEntry(msg)!;
    expect(entry.kind).toBe('policy');
    expect(entry.summary).toBe('policy approved: rm -rf /tmp/cache');
  });

  it('prefixes subagent-produced tool calls with the subagent marker and id', () => {
    // A tool call emitted *inside* a subagent turn. The formatter flags it via
    // `subagentId`; the renderer then prefixes the entry with 🤖 <short-id> so
    // the reader knows which delegated turn produced the activity.
    const parent = formatTurnLogEntry(makeTool({ name: 'Bash', payload: { command: 'ls' } }))!;
    const child = formatTurnLogEntry(
      makeTool({
        name: 'Bash',
        payload: { command: 'sleep 20' },
        subagentId: 'sub-1',
      })
    )!;
    // Run both through condenseTurnLog to observe the rendered form.
    const rendered = condenseTurnLog([parent, child], { maxChars: 500 });
    expect(rendered.kind).toBe('fits');
    if (rendered.kind !== 'fits') return;
    const [parentLine, childLine] = rendered.text.split('\n');
    expect(parentLine).not.toContain('🤖');
    expect(parentLine).toContain('🧑‍💻 ls');
    expect(childLine).toContain('🤖 sub-1 🧑‍💻 sleep 20');
  });

  it('shortens UUID subagent ids in the marker prefix', () => {
    const uuid = '5ea7b9ba-5103-40ee-95b6-c90808bbc431';
    const entry = formatTurnLogEntry(
      makeTool({
        name: 'Bash',
        payload: { command: 'ls' },
        subagentId: uuid,
      })
    )!;
    const rendered = condenseTurnLog([entry], { maxChars: 500 });
    if (rendered.kind !== 'fits') throw new Error('expected fits');
    expect(rendered.text).toContain('🤖 5ea7b9ba 🧑‍💻 ls');
    expect(rendered.text).not.toContain(uuid);
  });

  it('does not mark subagent boundary events (prompt/reply/status)', () => {
    // These kinds already name the subagent via 👉/👈/✅; a second marker is noise.
    const prompt: UserMessage = {
      id: 'p',
      role: 'user',
      content: 'do it',
      timestamp: FIXED_TS,
      sessionId: 's',
      subagentId: 'sub-1',
    };
    const reply: AgentReplyMessage = {
      id: 'r',
      role: 'agent',
      content: 'done',
      timestamp: FIXED_TS,
      sessionId: 's',
      subagentId: 'sub-1',
    };
    const status: SubagentStatusMessage = {
      id: 'st',
      role: 'subagent_status',
      content: '',
      timestamp: FIXED_TS,
      sessionId: 's',
      subagentId: 'sub-1',
      status: 'completed',
    };
    const entries = [prompt, reply, status].map((m) => formatTurnLogEntry(m)!);
    const rendered = condenseTurnLog(entries, { maxChars: 500 });
    if (rendered.kind !== 'fits') throw new Error('expected fits');
    expect(rendered.text).not.toContain('🤖');
  });

  it('drops CommandLogMessage from the turn log', () => {
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
    expect(formatTurnLogEntry(msg)).toBeNull();
  });

  it('formats a SystemMessage', () => {
    const msg: SystemMessage = {
      id: '1',
      role: 'system',
      content: 'stuff',
      timestamp: FIXED_TS,
      sessionId: 's',
      event: 'cron',
    };
    const entry = formatTurnLogEntry(msg);
    expect(entry!.kind).toBe('system');
    expect(entry!.summary).toBe('cron: stuff');
  });

  it('drops subagent_update system messages (orchestration plumbing)', () => {
    const msg: SystemMessage = {
      id: '1',
      role: 'system',
      content: '<notification>Subagent x completed.</notification>',
      timestamp: FIXED_TS,
      sessionId: 's',
      event: 'subagent_update',
    };
    expect(formatTurnLogEntry(msg)).toBeNull();
  });

  it('truncates tool principal-arg longer than maxToolPreview', () => {
    const msg = makeTool({ name: 'Bash', payload: { command: 'x'.repeat(500) } });
    const entry = formatTurnLogEntry(msg, { maxToolPreview: 100 })!;
    expect(entry.summary).toContain('[truncated]');
    expect(entry.summary.length).toBeLessThanOrEqual(200);
    expect(entry.rawLength).toBe(500);
  });

  it('replaces newlines in tool principal-arg with spaces', () => {
    const msg = makeTool({ name: 'Bash', payload: { command: 'line1\nline2\nline3' } });
    const entry = formatTurnLogEntry(msg)!;
    expect(entry.summary).not.toContain('\n');
    expect(entry.summary).toContain('line1');
    expect(entry.summary).toContain('line3');
  });

  it('renders relative timestamps when turnStartedAt is supplied', () => {
    const start = '2026-04-20T12:04:02.000Z';
    const make = (offsetMs: number): SubagentStatusMessage => ({
      id: '1',
      role: 'subagent_status',
      content: '',
      timestamp: new Date(new Date(start).getTime() + offsetMs).toISOString(),
      sessionId: 's',
      subagentId: 'sub-1',
      status: 'completed',
    });
    expect(formatTurnLogEntry(make(0), { turnStartedAt: start })!.timestamp).toBe('0s');
    expect(formatTurnLogEntry(make(5_000), { turnStartedAt: start })!.timestamp).toBe('5s');
    expect(formatTurnLogEntry(make(60_000), { turnStartedAt: start })!.timestamp).toBe('1m');
    expect(formatTurnLogEntry(make(125_000), { turnStartedAt: start })!.timestamp).toBe('2m5s');
  });

  it('falls back to wall-clock timestamps when turnStartedAt is omitted', () => {
    const msg = makeTool({ payload: { file_path: 'x.md' } });
    const entry = formatTurnLogEntry(msg)!;
    expect(entry.timestamp).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });
});

describe('buildTurnStartEntry', () => {
  it('renders the opening line with a 0s timestamp and start emoji', () => {
    const entry = buildTurnStartEntry();
    expect(entry.timestamp).toBe('0s');
    expect(entry.kind).toBe('system');
    expect(entry.summary).toContain(TURN_START_EMOJI);
    expect(entry.summary).toContain('Started processing');
    expect(entry.subagentId).toBeUndefined();
  });

  it('renders cleanly through condenseTurnLog (no subagent marker)', () => {
    const entry = buildTurnStartEntry();
    const rendered = condenseTurnLog([entry], { maxChars: 500 });
    expect(rendered.kind).toBe('fits');
    if (rendered.kind !== 'fits') return;
    expect(rendered.text).not.toContain('🤖');
    expect(rendered.text).toContain('0s');
    expect(rendered.text).toContain('Started processing');
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
  it('fits when under budget', () => {
    const entries = [mkEntry('Read(small)'), mkEntry('Grep(small)')];
    const result = condenseTurnLog(entries, { maxChars: 500 });
    expect(result.kind).toBe('fits');
    if (result.kind === 'fits') {
      expect(result.text).toContain('Read');
      expect(result.text).toContain('Grep');
    }
  });

  it('rolls over when exceeded', () => {
    const entries = Array.from({ length: 20 }, (_, i) => mkEntry('X'.repeat(40) + ` #${i}`));
    const result = condenseTurnLog(entries, { maxChars: 200 });
    expect(result.kind).toBe('rollover');
    if (result.kind === 'rollover') {
      expect(result.finalText).toContain('…log continues');
      expect(result.carryEntries.length).toBeGreaterThan(0);
      expect(result.carryEntries.length).toBeLessThan(entries.length);
    }
  });

  it('is pure — does not mutate input', () => {
    const entries = [mkEntry('one'), mkEntry('two')];
    const copy = entries.map((e) => ({ ...e }));
    const r1 = condenseTurnLog(entries, { maxChars: 500 });
    const r2 = condenseTurnLog(entries, { maxChars: 500 });
    expect(r1).toEqual(r2);
    expect(entries).toEqual(copy);
  });
});
