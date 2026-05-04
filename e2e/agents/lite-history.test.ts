import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import fs from 'node:fs';
import {
  TestEnvironment,
  type ChatSubscription,
  commandMatching,
} from '../_helpers/test-environment.js';

interface HistoryEntry {
  id: string;
  role: 'user' | 'agent';
  content: string;
  timestamp: string;
  files?: string[];
  sessionId?: string;
}

interface HistoryEnvelope {
  messages: HistoryEntry[];
  hasMore: boolean;
  oldestId?: string;
}

// Covers the `clawmini-lite history` command and the daemon-side
// `getThreadHistory` procedure. See docs/prev-messages/SPEC.md.
describe('E2E Lite History', () => {
  let env: TestEnvironment;
  let chat: ChatSubscription | undefined;

  beforeAll(async () => {
    env = new TestEnvironment('e2e-lite-history');
    await env.setup();
    await env.setupSubagentEnv();
    await env.getAgentCredentials();
  }, 30000);

  afterAll(() => env.teardown(), 30000);
  afterEach(() => env.disconnectAll());

  // Helper: collect history --json envelope for a chat using its credentials.
  async function fetchHistory(
    creds: { url: string; token: string },
    args: string[] = []
  ): Promise<HistoryEnvelope> {
    const { stdout, stderr, code } = await env.runLite(['history', '--json', ...args], { creds });
    expect(code, `history failed: ${stderr}`).toBe(0);
    const lines = stdout.trim().split('\n');
    return JSON.parse(lines[lines.length - 1]!) as HistoryEnvelope;
  }

  it('returns the user-visible thread, oldest first', async () => {
    const creds = await env.getAgentCredentialsForChat('hist-basic');
    chat = await env.connect('hist-basic');

    // Send three user messages. Each triggers debug-agent which emits a
    // command_log (filtered out). Then seed an agent reply via runLite for
    // each so we end up with at least three user/agent pairs.
    for (const text of ['user-msg-1', 'user-msg-2', 'user-msg-3']) {
      await env.sendMessage(text, { chat: 'hist-basic', agent: 'debug-agent' });
      await chat.waitForMessage(commandMatching((m) => m.content.includes(text)));
      await env.runLite(['reply', `reply-to-${text}`], { creds });
    }

    const env1 = await fetchHistory(creds);
    // The original "echo URL=..." bootstrap message + 3 user messages + 3
    // agent replies → at least 7. We assert >=6 to match the spec.
    expect(env1.messages.length).toBeGreaterThanOrEqual(6);

    const timestamps = env1.messages.map((m) => Date.parse(m.timestamp));
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]!).toBeGreaterThanOrEqual(timestamps[i - 1]!);
    }

    const firstSeedIdx = env1.messages.findIndex((m) => m.content === 'user-msg-1');
    const lastReplyIdx = env1.messages.map((m) => m.content).lastIndexOf('reply-to-user-msg-3');
    expect(firstSeedIdx).toBeGreaterThanOrEqual(0);
    expect(lastReplyIdx).toBeGreaterThan(firstSeedIdx);

    for (const m of env1.messages) {
      expect(['user', 'agent']).toContain(m.role);
    }
  }, 60000);

  it('excludes tool, command, policy, and subagent_status messages', async () => {
    const creds = await env.getAgentCredentialsForChat('hist-noise');
    chat = await env.connect('hist-noise');

    await env.sendMessage('noise-user', { chat: 'hist-noise', agent: 'debug-agent' });
    await chat.waitForMessage(commandMatching((m) => m.content.includes('noise-user')));
    await env.runLite(['reply', 'noise-agent-reply'], { creds });

    // Emit a tool message via lite. The role is 'tool' which must be
    // filtered out.
    await env.runLite(['tool', 'mytool', JSON.stringify({ k: 'v' })], { creds });

    // Seed a synthetic policy request directly on disk.
    env.appendRawChatLine('hist-noise', {
      id: 'pol-1',
      messageId: 'pol-msg-1',
      role: 'policy',
      requestId: 'req-1',
      commandName: 'fake',
      args: [],
      status: 'pending',
      content: '',
      timestamp: new Date().toISOString(),
      sessionId: 'fake-session',
    });

    // Seed a synthetic subagent_status entry.
    env.appendRawChatLine('hist-noise', {
      id: 'sub-stat-1',
      role: 'subagent_status',
      subagentId: 'fake-sub',
      status: 'completed',
      content: '',
      timestamp: new Date().toISOString(),
      sessionId: 'fake-session',
    });

    const envelope = await fetchHistory(creds);

    expect(envelope.messages.some((m) => m.content === 'noise-user')).toBe(true);
    expect(envelope.messages.some((m) => m.content === 'noise-agent-reply')).toBe(true);
    for (const m of envelope.messages) {
      expect(['user', 'agent']).toContain(m.role);
    }
  }, 30000);

  it('excludes router auto-replies (displayRole agent), keeps adapter echoes (displayRole user)', async () => {
    const creds = await env.getAgentCredentialsForChat('hist-display-roles');
    chat = await env.connect('hist-display-roles');

    env.appendRawChatLine('hist-display-roles', {
      id: 'sys-router-auto',
      role: 'system',
      event: 'router',
      displayRole: 'agent',
      content: 'router auto-reply',
      timestamp: new Date(Date.now() - 1000).toISOString(),
      sessionId: 'fake',
    });
    env.appendRawChatLine('hist-display-roles', {
      id: 'sys-slash-echo',
      role: 'system',
      event: 'other',
      displayRole: 'user',
      content: 'slash echo',
      timestamp: new Date(Date.now() - 500).toISOString(),
      sessionId: 'fake',
    });

    await env.sendMessage('display-roles-user', {
      chat: 'hist-display-roles',
      agent: 'debug-agent',
    });
    await chat.waitForMessage(commandMatching((m) => m.content.includes('display-roles-user')));
    await env.runLite(['reply', 'display-roles-reply'], { creds });

    const envelope = await fetchHistory(creds);

    // Auto-reply with displayRole='agent' must be absent.
    expect(envelope.messages.some((m) => m.content === 'router auto-reply')).toBe(false);
    // Adapter echo with displayRole='user' must be present, normalized to user.
    const echo = envelope.messages.find((m) => m.content === 'slash echo');
    expect(echo).toBeTruthy();
    expect(echo!.role).toBe('user');
    // Real conversation around the synthetic entries:
    expect(envelope.messages.some((m) => m.content === 'display-roles-user')).toBe(true);
    expect(envelope.messages.some((m) => m.content === 'display-roles-reply')).toBe(true);

    const userIdx = envelope.messages.findIndex((m) => m.content === 'display-roles-user');
    const replyIdx = envelope.messages.findIndex((m) => m.content === 'display-roles-reply');
    expect(replyIdx).toBeGreaterThan(userIdx);
  }, 30000);

  it('paginates via --limit and --before', async () => {
    const creds = await env.getAgentCredentialsForChat('hist-page');
    // Truncate the bootstrap message — we need exactly 14 visible messages.
    const chatFile = env.getChatPath('hist-page', 'chat.jsonl');
    fs.writeFileSync(chatFile, '');

    // Seed 7 user/agent message pairs as raw jsonl entries with monotonic
    // timestamps, so we don't have to wait on the agent loop.
    const baseTime = Date.now();
    for (let i = 0; i < 7; i++) {
      env.appendRawChatLine('hist-page', {
        id: `u-${i}`,
        role: 'user',
        content: `user-${i}`,
        timestamp: new Date(baseTime + i * 1000).toISOString(),
        sessionId: 'sess-1',
      });
      env.appendRawChatLine('hist-page', {
        id: `a-${i}`,
        role: 'agent',
        content: `agent-${i}`,
        timestamp: new Date(baseTime + i * 1000 + 500).toISOString(),
        sessionId: 'sess-1',
      });
    }

    const page1 = await fetchHistory(creds, ['--limit', '5']);
    expect(page1.messages.length).toBe(5);
    expect(page1.hasMore).toBe(true);
    expect(page1.oldestId).toBe(page1.messages[0]!.id);
    // Most recent 5 visible messages, oldest-first within the page:
    expect(page1.messages.map((m) => m.content)).toEqual([
      'agent-4',
      'user-5',
      'agent-5',
      'user-6',
      'agent-6',
    ]);

    const page2 = await fetchHistory(creds, ['--limit', '5', '--before', page1.oldestId!]);
    expect(page2.messages.length).toBe(5);
    expect(page2.hasMore).toBe(true);
    const page1OldestTs = Date.parse(page1.messages[0]!.timestamp);
    for (const m of page2.messages) {
      expect(Date.parse(m.timestamp)).toBeLessThan(page1OldestTs);
    }

    const page3 = await fetchHistory(creds, ['--limit', '5', '--before', page2.oldestId!]);
    expect(page3.messages.length).toBe(4);
    expect(page3.hasMore).toBe(false);
  }, 30000);

  it('rejects subagent tokens', async () => {
    await env.addChat('hist-sub-chat', 'debug-agent');
    chat = await env.connect('hist-sub-chat');

    // Spawn an async subagent whose only job is to call `clawmini-lite history`.
    // The CLI inside the subagent uses CLAW_API_TOKEN with subagentId set.
    await env.sendMessage(
      'clawmini-lite.js subagents spawn --id hist-test-sub --async "clawmini-lite.js history"',
      { chat: 'hist-sub-chat', agent: 'debug-agent' }
    );

    // The subagent's command_log should contain the rejection from the daemon.
    const subLog = await chat.waitForMessage(
      commandMatching(
        (m) =>
          m.subagentId === 'hist-test-sub' &&
          /thread history is not available to subagents/.test(
            m.stdout + m.stderr + JSON.stringify(m)
          )
      ),
      20000
    );
    // The CLI exits non-zero when the daemon returns BAD_REQUEST.
    expect(subLog.exitCode).not.toBe(0);
    // No history content leaked: the subagent never printed a [USER] or [AGENT]
    // line on stdout.
    expect(subLog.stdout).not.toMatch(/^\[USER\]/m);
    expect(subLog.stdout).not.toMatch(/^\[AGENT\]/m);
  }, 30000);

  it('default text output', async () => {
    const creds = await env.getAgentCredentialsForChat('hist-text');
    const chatFile = env.getChatPath('hist-text', 'chat.jsonl');
    fs.writeFileSync(chatFile, '');

    const t = Date.now();
    env.appendRawChatLine('hist-text', {
      id: 't-u-1',
      role: 'user',
      content: 'first',
      timestamp: new Date(t).toISOString(),
      sessionId: 's',
    });
    env.appendRawChatLine('hist-text', {
      id: 't-a-1',
      role: 'agent',
      content: 'hi',
      timestamp: new Date(t + 1000).toISOString(),
      sessionId: 's',
    });
    env.appendRawChatLine('hist-text', {
      id: 't-u-2',
      role: 'user',
      content: 'second',
      timestamp: new Date(t + 2000).toISOString(),
      sessionId: 's',
    });

    const { stdout, code } = await env.runLite(['history'], { creds });
    expect(code).toBe(0);
    expect(stdout).toBe(`[USER] first\n[AGENT] hi\n[USER] second\n`);
    expect(stdout).not.toContain('hasMore:');
    expect(stdout).not.toContain('oldestId:');

    // Seed enough additional messages to push hasMore=true at limit=2.
    env.appendRawChatLine('hist-text', {
      id: 't-a-2',
      role: 'agent',
      content: 'three',
      timestamp: new Date(t + 3000).toISOString(),
      sessionId: 's',
    });
    env.appendRawChatLine('hist-text', {
      id: 't-u-3',
      role: 'user',
      content: 'four',
      timestamp: new Date(t + 4000).toISOString(),
      sessionId: 's',
    });

    const limited = await env.runLite(['history', '--limit', '2'], { creds });
    expect(limited.code).toBe(0);
    expect(limited.stdout).toContain('---\n');
    expect(limited.stdout).toContain('hasMore: true');

    const limitedJson = await fetchHistory(creds, ['--limit', '2']);
    expect(limited.stdout).toContain(`oldestId: ${limitedJson.oldestId}`);
  }, 30000);

  it('returns messages that span multiple agent sessions', async () => {
    // The point of getThreadHistory is that its results are NOT scoped to the
    // caller's current session — messages written by an earlier session must
    // still be visible. Seed two raw user messages with distinct sessionIds
    // to simulate "different daemon-side sessions appended to the same chat",
    // then assert both appear in chronological order from a fresh history call.
    const creds = await env.getAgentCredentialsForChat('hist-cross');
    const chatFile = env.getChatPath('hist-cross', 'chat.jsonl');
    fs.writeFileSync(chatFile, '');

    const t = Date.now();
    env.appendRawChatLine('hist-cross', {
      id: 'sess-a-user',
      role: 'user',
      content: 'cross-msg-1',
      timestamp: new Date(t).toISOString(),
      sessionId: 'session-A',
    });
    env.appendRawChatLine('hist-cross', {
      id: 'sess-a-agent',
      role: 'agent',
      content: 'reply-from-a',
      timestamp: new Date(t + 1000).toISOString(),
      sessionId: 'session-A',
    });
    env.appendRawChatLine('hist-cross', {
      id: 'sess-b-user',
      role: 'user',
      content: 'cross-msg-2',
      timestamp: new Date(t + 2000).toISOString(),
      sessionId: 'session-B',
    });
    env.appendRawChatLine('hist-cross', {
      id: 'sess-b-agent',
      role: 'agent',
      content: 'reply-from-b',
      timestamp: new Date(t + 3000).toISOString(),
      sessionId: 'session-B',
    });

    const envelope = await fetchHistory(creds);
    const contents = envelope.messages.map((m) => m.content);
    expect(contents).toEqual(['cross-msg-1', 'reply-from-a', 'cross-msg-2', 'reply-from-b']);

    const sessions = new Set(envelope.messages.map((m) => m.sessionId));
    expect(sessions.has('session-A')).toBe(true);
    expect(sessions.has('session-B')).toBe(true);
  }, 30000);

  it('returns empty messages and no footer for a chat with no visible traffic', async () => {
    const creds = await env.getAgentCredentialsForChat('hist-empty');
    // getAgentCredentialsForChat seeded a user message + command_log. Truncate
    // so the chat has only invisible (command/tool) entries.
    const chatFile = env.getChatPath('hist-empty', 'chat.jsonl');
    fs.writeFileSync(chatFile, '');
    env.appendRawChatLine('hist-empty', {
      id: 'noise-cmd',
      role: 'command',
      messageId: 'cmd-msg-1',
      command: 'noop',
      cwd: '/',
      stdout: '',
      stderr: '',
      exitCode: 0,
      content: '',
      timestamp: new Date().toISOString(),
      sessionId: 'fake',
    });
    env.appendRawChatLine('hist-empty', {
      id: 'noise-legacy',
      role: 'legacy_log',
      content: '',
      timestamp: new Date().toISOString(),
      sessionId: 'fake',
    });

    const envelope = await fetchHistory(creds);
    expect(envelope.messages).toEqual([]);
    expect(envelope.hasMore).toBe(false);
    expect(envelope.oldestId).toBeUndefined();

    const text = await env.runLite(['history'], { creds });
    expect(text.code).toBe(0);
    expect(text.stdout).toBe('');
  }, 30000);
});
