import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  TestEnvironment,
  type ChatSubscription,
  commandMatching,
} from '../_helpers/test-environment.js';

// Ticket 4: approval gating for subagent spawn / send.
//
// Rules live under `subagents` in `.clawmini/policies.json`; built-in
// `$self → $self` is appended at evaluation time. Spec §4 (especially
// §4.2 / §4.4 / §7.5).
//
// Each test writes a fresh `policies.json` *before* spawning, then asserts:
//   - the on-disk delegation record's `state` (pending vs running)
//   - that an approval preview message lands in the chat for pending edges
//   - that /approve transitions the record and lets the child run
//   - that /reject seals the record without ever starting the child

describe('Subagent approval gating (e2e)', () => {
  let env: TestEnvironment;
  let chat: ChatSubscription | undefined;

  // Helper: poll the delegation record until `predicate` passes, then return it.
  async function waitForRecord(
    chatId: string,
    id: string,
    predicate: (rec: Record<string, unknown>) => boolean,
    timeoutMs = 10_000
  ): Promise<Record<string, unknown>> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const rec = env.readDelegation(chatId, id);
      if (rec && predicate(rec)) return rec;
      await new Promise((r) => setTimeout(r, 100));
    }
    const rec = env.readDelegation(chatId, id);
    throw new Error(
      `Timed out waiting for delegation ${id} in chat ${chatId}; last seen: ${JSON.stringify(rec)}`
    );
  }

  // Helper: write the `subagents` rule list (and policies map) to
  // `.clawmini/policies.json`. The `writePolicies` helper only writes
  // `{ policies }`, so we go direct for the unified shape.
  function writePoliciesFile(content: Record<string, unknown>) {
    const p = path.resolve(env.e2eDir, '.clawmini', 'policies.json');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(content, null, 2));
  }

  function clearPoliciesFile() {
    const p = path.resolve(env.e2eDir, '.clawmini', 'policies.json');
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  beforeAll(async () => {
    env = new TestEnvironment('e2e-subagent-approval');
    await env.setup();
    await env.setupSubagentEnv();
    // Add a second agent so we can drive cross-agent spawns.
    await env.addAgent('other-agent');
    env.writeAgentSettings('other-agent', {
      commands: {
        new: 'echo "[OTHER] $CLAW_CLI_MESSAGE:" && eval "$CLAW_CLI_MESSAGE"',
        append: 'echo "[OTHER $SESSION_ID] $CLAW_CLI_MESSAGE:" && eval "$CLAW_CLI_MESSAGE"',
        getSessionId: 'node -e "console.log(Math.random().toString(36).slice(2, 10))"',
      },
    });
  }, 30000);

  afterAll(() => env.teardown(), 30000);
  afterEach(() => {
    clearPoliciesFile();
    return env.disconnectAll();
  });

  it('cross-agent spawn with no matching rule lands in pending and waits for /approve', async () => {
    // No `subagents` rules → only the built-in `$self → $self` applies, so a
    // cross-agent spawn (debug-agent → other-agent) has no matching rule
    // and defaults to require approval.
    const chatId = 'chat-cross-pending';
    await env.addChat(chatId, 'debug-agent');
    chat = await env.connect(chatId);

    await env.sendMessage(
      'clawmini-lite.js subagents spawn --id cross-1 --agent other-agent --delivery notify "echo should-not-run-yet"',
      { chat: chatId, agent: 'debug-agent' }
    );

    // Record must land at `pending` (not `running`).
    const rec = await waitForRecord(chatId, 'cross-1', (r) => r.state === 'pending');
    expect(rec.kind).toBe('subagent');
    expect(rec.targetAgentId).toBe('other-agent');
    expect(rec.prompt).toBe('echo should-not-run-yet');

    // A `role: 'policy'`-style approval message lands in the chat (matches
    // the policy preview rendering so existing chat adapters keep working).
    const previewMsg = await chat.waitForMessage(
      (m) => m.role === 'policy' && (m as { requestId?: string }).requestId === 'cross-1'
    );
    expect((previewMsg as { status?: string }).status).toBe('pending');
    expect((previewMsg as { content?: string }).content).toMatch(/cross-1/);
    expect((previewMsg as { content?: string }).content).toMatch(/\/approve cross-1/);

    // The subagent's own command_log must NOT have run yet (no [OTHER] echo).
    const ran = chat.messageBuffer.some(
      (m) =>
        (m as { subagentId?: string }).subagentId === 'cross-1' ||
        (typeof (m as { stdout?: string }).stdout === 'string' &&
          (m as { stdout?: string }).stdout!.includes('[OTHER]'))
    );
    expect(ran).toBe(false);
  }, 30000);

  it('/approve <id> transitions a pending subagent to running and executes the prompt', async () => {
    const chatId = 'chat-approve-runs';
    await env.addChat(chatId, 'debug-agent');
    chat = await env.connect(chatId);

    await env.sendMessage(
      'clawmini-lite.js subagents spawn --id approve-1 --agent other-agent --delivery notify "echo approved-then-runs"',
      { chat: chatId, agent: 'debug-agent' }
    );
    await waitForRecord(chatId, 'approve-1', (r) => r.state === 'pending');

    await env.sendMessage('/approve approve-1', { chat: chatId });

    // The subagent should now run under other-agent, printing the [OTHER]
    // prefix from its own template.
    await chat.waitForMessage(
      commandMatching(
        (m) => m.subagentId === 'approve-1' && m.stdout.includes('approved-then-runs')
      ),
      15000
    );

    // Record should ultimately settle on completed.
    const rec = await waitForRecord(chatId, 'approve-1', (r) => r.state === 'completed');
    expect(rec.kind).toBe('subagent');
  }, 30000);

  it('/reject <id> seals the delegation and does not run the subagent', async () => {
    const chatId = 'chat-reject';
    await env.addChat(chatId, 'debug-agent');
    chat = await env.connect(chatId);

    await env.sendMessage(
      'clawmini-lite.js subagents spawn --id reject-1 --agent other-agent --delivery notify "echo never-runs"',
      { chat: chatId, agent: 'debug-agent' }
    );
    await waitForRecord(chatId, 'reject-1', (r) => r.state === 'pending');

    await env.sendMessage('/reject reject-1 not-trusted', { chat: chatId });

    const rec = await waitForRecord(chatId, 'reject-1', (r) => r.state === 'rejected');
    expect(rec.rejectionReason).toBe('not-trusted');
    expect(typeof rec.resolvedAt).toBe('string');

    // Give the daemon a beat — the subagent must never start.
    await new Promise((r) => setTimeout(r, 500));
    const ran = chat.messageBuffer.some(
      (m) =>
        (m as { subagentId?: string }).subagentId === 'reject-1' ||
        (typeof (m as { stdout?: string }).stdout === 'string' &&
          (m as { stdout?: string }).stdout!.includes('never-runs') &&
          (m as { subagentId?: string }).subagentId === 'reject-1')
    );
    expect(ran).toBe(false);
  }, 30000);

  it('built-in $self → $self auto-approves spawning the same agent with no rules', async () => {
    const chatId = 'chat-builtin-self';
    await env.addChat(chatId, 'debug-agent');
    chat = await env.connect(chatId);

    // Same agent (debug-agent → debug-agent). No rules in policies.json →
    // built-in `$self → $self` kicks in and the spawn auto-approves.
    await env.sendMessage('clawmini-lite.js subagents spawn --id self-1 --delivery notify "echo self-runs"', {
      chat: chatId,
      agent: 'debug-agent',
    });
    await chat.waitForMessage(
      commandMatching((m) => m.subagentId === 'self-1' && m.stdout.includes('self-runs'))
    );

    const rec = await waitForRecord(
      chatId,
      'self-1',
      (r) => r.state === 'completed' || r.state === 'running'
    );
    expect(['running', 'completed']).toContain(rec.state);
    // Must never have been pending.
    expect(rec.state).not.toBe('pending');
  }, 30000);

  it('user rule {from: *, to: *, autoApprove: true} auto-approves anything', async () => {
    writePoliciesFile({
      policies: {},
      subagents: [{ from: '*', to: '*', autoApprove: true }],
    });

    const chatId = 'chat-star-star';
    await env.addChat(chatId, 'debug-agent');
    chat = await env.connect(chatId);

    // Cross-agent edge that would normally be pending now auto-approves.
    await env.sendMessage(
      'clawmini-lite.js subagents spawn --id star-1 --agent other-agent --delivery notify "echo star-runs"',
      { chat: chatId, agent: 'debug-agent' }
    );
    await chat.waitForMessage(
      commandMatching((m) => m.subagentId === 'star-1' && m.stdout.includes('star-runs')),
      15000
    );

    const rec = await waitForRecord(
      chatId,
      'star-1',
      (r) => r.state === 'completed' || r.state === 'running'
    );
    expect(['running', 'completed']).toContain(rec.state);
  }, 30000);

  it('first-match-wins: a user rule before the built-in disables self-clone', async () => {
    writePoliciesFile({
      policies: {},
      subagents: [{ from: '$self', to: '$self', autoApprove: false }],
    });

    const chatId = 'chat-self-disabled';
    await env.addChat(chatId, 'debug-agent');
    chat = await env.connect(chatId);

    await env.sendMessage(
      'clawmini-lite.js subagents spawn --id self-deny --delivery notify "echo self-denied"',
      { chat: chatId, agent: 'debug-agent' }
    );
    const rec = await waitForRecord(chatId, 'self-deny', (r) => r.state === 'pending');
    expect(rec.kind).toBe('subagent');

    // No [DEBUG] subagent stdout should have landed yet.
    const ran = chat.messageBuffer.some(
      (m) => (m as { subagentId?: string }).subagentId === 'self-deny'
    );
    expect(ran).toBe(false);
  }, 30000);

  it('subagents send is gated the same way as spawn', async () => {
    // 1. Allow the initial spawn (debug → other-agent) explicitly so we can
    //    test the send path independently.
    writePoliciesFile({
      policies: {},
      subagents: [{ from: '*', to: '*', autoApprove: true }],
    });
    const chatId = 'chat-send-gated';
    await env.addChat(chatId, 'debug-agent');
    chat = await env.connect(chatId);

    await env.sendMessage(
      'clawmini-lite.js subagents spawn --id send-gate --agent other-agent --delivery notify "echo send-gate-initial"',
      { chat: chatId, agent: 'debug-agent' }
    );
    await chat.waitForMessage(
      commandMatching((m) => m.subagentId === 'send-gate' && m.stdout.includes('send-gate-initial'))
    );
    await waitForRecord(chatId, 'send-gate', (r) => r.state === 'completed');

    // 2. Now tighten policies so the next `send` is NOT auto-approved.
    //    `[]` clears user rules; the built-in only covers self-clone, so
    //    debug-agent → other-agent reverts to pending.
    writePoliciesFile({ policies: {}, subagents: [] });

    await env.sendMessage(
      "clawmini-lite.js subagents send send-gate --delivery notify -p 'echo send-gate-second'",
      { chat: chatId, agent: 'debug-agent' }
    );

    // Record should flip to pending and prompt should reflect the new send.
    const rec = await waitForRecord(
      chatId,
      'send-gate',
      (r) => r.state === 'pending' && r.prompt === 'echo send-gate-second'
    );
    expect(rec.kind).toBe('subagent');

    // The new send must NOT have produced the second-echo subagent output yet.
    const ranSecond = chat.messageBuffer.some(
      (m) =>
        (m as { subagentId?: string }).subagentId === 'send-gate' &&
        typeof (m as { stdout?: string }).stdout === 'string' &&
        (m as { stdout?: string }).stdout!.includes('send-gate-second')
    );
    expect(ranSecond).toBe(false);
  }, 30000);

  it('prefix matching: a rule on a parent dir matches subagents inside that dir', async () => {
    // Use agent.directory to give two agents matching paths under `agents/coding/`.
    // Pre-create the working dirs (TestEnvironment.writeAgentSettings
    // bypasses `ensureAgentWorkDir`), and propagate the debug-agent PATH so
    // `clawmini-lite.js` is reachable inside the spawned subagent shell.
    const coder1Dir = path.resolve(env.e2eDir, 'agents/coding/coder-1');
    const coder2Dir = path.resolve(env.e2eDir, 'agents/coding/coder-2');
    fs.mkdirSync(coder1Dir, { recursive: true });
    fs.mkdirSync(coder2Dir, { recursive: true });

    const debugEnv =
      (env.getAgentSettings('debug-agent') as { env?: Record<string, string> }).env ?? {};

    await env.addAgent('coder-1');
    env.writeAgentSettings('coder-1', {
      directory: 'agents/coding/coder-1',
      env: debugEnv,
      commands: {
        new: 'echo "[C1] $CLAW_CLI_MESSAGE:" && eval "$CLAW_CLI_MESSAGE"',
        append: 'echo "[C1 $SESSION_ID] $CLAW_CLI_MESSAGE:" && eval "$CLAW_CLI_MESSAGE"',
        getSessionId: 'node -e "console.log(Math.random().toString(36).slice(2, 10))"',
      },
    });
    await env.addAgent('coder-2');
    env.writeAgentSettings('coder-2', {
      directory: 'agents/coding/coder-2',
      env: debugEnv,
      commands: {
        new: 'echo "[C2] $CLAW_CLI_MESSAGE:" && eval "$CLAW_CLI_MESSAGE"',
        append: 'echo "[C2 $SESSION_ID] $CLAW_CLI_MESSAGE:" && eval "$CLAW_CLI_MESSAGE"',
        getSessionId: 'node -e "console.log(Math.random().toString(36).slice(2, 10))"',
      },
    });
    writePoliciesFile({
      policies: {},
      subagents: [{ from: 'agents/coding', to: 'agents/coding', autoApprove: true }],
    });

    const chatId = 'chat-prefix';
    await env.addChat(chatId, 'coder-1');
    chat = await env.connect(chatId);

    // coder-1 → coder-2: both inside `agents/coding/`, so the prefix rule
    // should auto-approve. We assert via the on-disk record (the [C1]/[C2]
    // command templates run inside their respective working dirs which
    // means writing them through `clawmini-lite.js` from the parent's
    // chat shows the expected stdout under the parent agent's debug echo).
    await env.sendMessage(
      'clawmini-lite.js subagents spawn --id prefix-1 --agent coder-2 --delivery notify "echo prefix-runs"',
      { chat: chatId, agent: 'coder-1' }
    );

    // The record should immediately land at `running` (not `pending`) — that
    // is the only assertion this case needs. The spec's prefix-matching
    // semantics live in approvals.test.ts (unit); here we just confirm the
    // rule actually wires through `readPoliciesForPath` + `getAgentPath`.
    const rec = await waitForRecord(
      chatId,
      'prefix-1',
      (r) => r.state === 'running' || r.state === 'completed'
    );
    expect(rec.kind).toBe('subagent');
    expect(rec.state).not.toBe('pending');
  }, 30000);
});
