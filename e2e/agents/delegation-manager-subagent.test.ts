import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import {
  TestEnvironment,
  type ChatSubscription,
  commandMatching,
  commandWith,
} from '../_helpers/test-environment.js';

// Ticket 3: subagent RPCs now read/write through `DelegationManager`. Records
// live under `.clawmini/tmp/delegations/<chatId>/<id>.json` with `kind:
// 'subagent'`. The CLI still drives `subagents {spawn, send, wait, stop,
// tail}`; we observe the on-disk state to assert the manager owns the
// lifecycle. Ticket 6 will add `delegations show <id>`.

describe('Subagent delegations via DelegationManager (e2e)', () => {
  let env: TestEnvironment;
  let chat: ChatSubscription | undefined;

  beforeAll(async () => {
    env = new TestEnvironment('e2e-delegation-subagent');
    await env.setup();
    await env.setupSubagentEnv();
  }, 30000);

  afterAll(() => env.teardown(), 30000);
  afterEach(() => env.disconnectAll());

  it('spawn writes a subagent record with kind/state/sessionId/prompt + 3-char id', async () => {
    const chatId = 'chat-spawn-record';
    await env.addChat(chatId, 'debug-agent');
    chat = await env.connect(chatId);

    // No --id: the daemon mints a 3-char alphanum id via DelegationStore.
    await env.sendMessage(
      'clawmini-lite.js subagents spawn --async "sleep 1 && echo spawn-record"',
      { chat: chatId, agent: 'debug-agent' }
    );

    const announce = await chat.waitForMessage(
      commandMatching(
        (m) =>
          !m.subagentId &&
          /Subagent spawned successfully with ID: [0-9a-z]{3,}\b/.test(m.stdout)
      )
    );
    const idMatch = announce.stdout.match(
      /Subagent spawned successfully with ID: ([0-9a-z]{3,})\b/
    );
    expect(idMatch).not.toBeNull();
    const id = idMatch![1]!;
    expect(id).toMatch(/^[0-9a-z]{3,}$/);
    // Must NOT be a UUID (the legacy id shape).
    expect(id).not.toMatch(/^[0-9a-f-]{36}$/);

    const rec = env.readDelegation(chatId, id) as
      | {
          id?: string;
          kind?: string;
          state?: string;
          targetAgentId?: string;
          sessionId?: string;
          prompt?: string;
          delivery?: string;
          parentId?: string;
        }
      | null;
    expect(rec).not.toBeNull();
    expect(rec?.id).toBe(id);
    expect(rec?.kind).toBe('subagent');
    // While the subagent is still sleeping, state should be 'running' (we
    // skipped the pending step because subagent spawn auto-approves today).
    expect(['running', 'completed']).toContain(rec?.state);
    expect(rec?.targetAgentId).toBe('debug-agent');
    expect(rec?.sessionId).toBeTruthy();
    expect(typeof rec?.sessionId).toBe('string');
    expect(rec?.prompt).toBe('sleep 1 && echo spawn-record');
    // Root-agent default delivery is 'notify' (today's async behavior).
    expect(rec?.delivery).toBe('notify');
    // Top-level spawn — no parentId.
    expect(rec?.parentId).toBeUndefined();
  }, 30000);

  it('subagents tail still reads the subagent chat log (no behavior change)', async () => {
    const chatId = 'chat-tail-passthrough';
    await env.addChat(chatId, 'debug-agent');
    chat = await env.connect(chatId);

    await env.sendMessage(
      'clawmini-lite.js subagents spawn --id tail-record --async "echo tail-payload"',
      { chat: chatId, agent: 'debug-agent' }
    );
    await chat.waitForMessage(
      commandMatching((m) => m.subagentId === 'tail-record' && m.stdout.includes('tail-payload'))
    );

    await env.sendMessage('clawmini-lite.js subagents tail tail-record --json', {
      chat: chatId,
      agent: 'debug-agent',
    });

    const tailLog = await chat.waitForMessage(
      commandMatching(
        (m) =>
          !m.subagentId &&
          m.stdout.includes('subagents tail tail-record --json:') &&
          m.stdout.includes('tail-payload')
      )
    );
    expect(tailLog.exitCode).toBe(0);
  }, 30000);

  it('subagents send updates `prompt` on the delegation record', async () => {
    const chatId = 'chat-send-updates-prompt';
    await env.addChat(chatId, 'debug-agent');
    chat = await env.connect(chatId);

    await env.sendMessage(
      'clawmini-lite.js subagents spawn --id send-prompt --async "echo first-prompt"',
      { chat: chatId, agent: 'debug-agent' }
    );
    await chat.waitForMessage(
      commandMatching((m) => m.subagentId === 'send-prompt' && m.stdout.includes('first-prompt'))
    );

    // Pre-send, prompt is 'echo first-prompt'.
    const before = env.readDelegation(chatId, 'send-prompt') as { prompt?: string } | null;
    expect(before?.prompt).toBe('echo first-prompt');

    await env.sendMessage(
      "clawmini-lite.js subagents send send-prompt --async -p 'echo second-prompt'",
      { chat: chatId, agent: 'debug-agent' }
    );
    await chat.waitForMessage(
      commandMatching((m) => m.subagentId === 'send-prompt' && m.stdout.includes('second-prompt'))
    );

    // Post-send, the record's prompt is rewritten to the new message.
    let after: { prompt?: string } | null = null;
    for (let i = 0; i < 50; i++) {
      after = env.readDelegation(chatId, 'send-prompt') as { prompt?: string } | null;
      if (after?.prompt === 'echo second-prompt') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(after?.prompt).toBe('echo second-prompt');
  }, 30000);

  it('terminal status writes state=completed with resolvedAt set', async () => {
    const chatId = 'chat-terminal-completed';
    await env.addChat(chatId, 'debug-agent');
    chat = await env.connect(chatId);

    await env.sendMessage(
      'clawmini-lite.js subagents spawn --id done-record --async "echo done"',
      { chat: chatId, agent: 'debug-agent' }
    );
    await chat.waitForMessage(
      commandMatching((m) => m.subagentId === 'done-record' && m.stdout.includes('done'))
    );

    let rec: { state?: string; resolvedAt?: string } | null = null;
    for (let i = 0; i < 80; i++) {
      rec = env.readDelegation(chatId, 'done-record') as
        | { state?: string; resolvedAt?: string }
        | null;
      if (rec?.state === 'completed') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(rec?.state).toBe('completed');
    expect(typeof rec?.resolvedAt).toBe('string');
  }, 30000);

  it('subagentWait returns the completed result via the manager wrapper', async () => {
    const chatId = 'chat-wait-wrapper';
    await env.addChat(chatId, 'debug-agent');
    chat = await env.connect(chatId);

    // Pair a spawn with an immediate wait so the wait blocks on the
    // single-id sync path before completion. The CLI `subagents wait` polls
    // until the wrapped subagentWait reports a terminal status.
    await env.sendMessage(
      'clawmini-lite.js subagents spawn --id wait-thin --async "sleep 1 && echo wait-thin-output" && clawmini-lite.js subagents wait wait-thin',
      { chat: chatId, agent: 'debug-agent' }
    );

    // The parent's outer command_log carries the wait output: the subagent's
    // last agent-role message (the debug template's echo of the inner sleep).
    const waitLog = await chat.waitForMessage(
      commandMatching(
        (m) =>
          !m.subagentId &&
          m.stdout.includes('[DEBUG] sleep 1 && echo wait-thin-output:')
      ),
      20000
    );
    expect(waitLog.exitCode).toBe(0);
  }, 30000);

  it('subagents stop transitions the record to state=failed with rejectionReason', async () => {
    const chatId = 'chat-stop-failed';
    await env.addChat(chatId, 'debug-agent');
    chat = await env.connect(chatId);

    await env.sendMessage(
      'clawmini-lite.js subagents spawn --id stop-failed --async "sleep 30 && echo never"',
      { chat: chatId, agent: 'debug-agent' }
    );
    // Wait for the running state.
    for (let i = 0; i < 50; i++) {
      const rec = env.readDelegation(chatId, 'stop-failed');
      if (rec && (rec.state as string) === 'running') break;
      await new Promise((r) => setTimeout(r, 100));
    }

    await env.sendMessage('clawmini-lite.js subagents stop stop-failed', {
      chat: chatId,
      agent: 'debug-agent',
    });
    await chat.waitForMessage(commandWith('Subagent stop-failed stopped'));

    let final: { state?: string; rejectionReason?: string; resolvedAt?: string } | null = null;
    for (let i = 0; i < 80; i++) {
      final = env.readDelegation(chatId, 'stop-failed') as
        | { state?: string; rejectionReason?: string; resolvedAt?: string }
        | null;
      if (final && final.state !== 'running' && final.state !== 'pending') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(final?.state).toBe('failed');
    expect(typeof final?.rejectionReason).toBe('string');
    expect(final?.rejectionReason).toMatch(/stop/i);
    expect(typeof final?.resolvedAt).toBe('string');
  }, 30000);
});
