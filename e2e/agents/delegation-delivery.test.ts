/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import fs from 'node:fs';
import {
  TestEnvironment,
  type ChatSubscription,
  type ChatMessage,
  commandMatching,
} from '../_helpers/test-environment.js';

// Ticket 7: `--delivery <manual|notify>` on `subagents spawn`, `subagents
// send`, and `request <cmd>`. Verifies the new defaults (spec §3.3: root →
// notify, subagent → manual), the per-id `<notification>` suppression for
// `manual`, and that the legacy `--async` boolean still works (with a
// deprecation warning).

describe('Delegation delivery flag (e2e)', () => {
  let env: TestEnvironment;
  let chat: ChatSubscription | undefined;

  beforeAll(async () => {
    env = new TestEnvironment('e2e-delegation-delivery');
    await env.setup();
    await env.setupSubagentEnv({
      policies: {
        'echo-policy': {
          description: 'Echo a fixed string',
          command: 'echo',
          args: ['delivery-ok'],
          autoApprove: true,
        },
      },
    });
  }, 30000);

  afterAll(() => env.teardown(), 30000);
  afterEach(() => env.disconnectAll());

  function readChatJsonl(chatId: string): ChatMessage[] {
    const file = env.getChatPath(chatId, 'chat.jsonl');
    if (!fs.existsSync(file)) return [];
    return fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as ChatMessage);
  }

  function countNotifications(chatId: string): number {
    return readChatJsonl(chatId).filter(
      (m) => typeof (m as any).content === 'string' && (m as any).content.includes('<notification>')
    ).length;
  }

  async function waitForState(
    chatId: string,
    id: string,
    predicate: (rec: Record<string, unknown>) => boolean,
    timeoutMs = 15_000
  ): Promise<Record<string, unknown>> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const rec = env.readDelegation(chatId, id);
      if (rec && predicate(rec)) return rec;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`Timed out waiting for delegation ${id} in chat ${chatId}`);
  }

  it('subagents spawn --delivery notify appends a <notification> on resolve (root agent)', async () => {
    const chatId = 'deliv-notify-root';
    await env.addChat(chatId, 'debug-agent');
    chat = await env.connect(chatId);

    await env.sendMessage(
      'clawmini-lite.js subagents spawn --id deliv-notify --delivery notify "echo notify-deliv"',
      { chat: chatId, agent: 'debug-agent' }
    );
    await chat.waitForMessage(
      commandMatching((m) => m.subagentId === 'deliv-notify' && m.stdout.includes('notify-deliv'))
    );

    await waitForState(chatId, 'deliv-notify', (r) => r.state === 'completed');
    // Allow the notify path to land.
    const start = Date.now();
    while (Date.now() - start < 5_000) {
      if (countNotifications(chatId) >= 1) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(countNotifications(chatId)).toBeGreaterThanOrEqual(1);
  }, 30000);

  it('subagents spawn --delivery manual suppresses the per-id <notification>; result observable via delegations show', async () => {
    const chatId = 'deliv-manual-root';
    await env.addChat(chatId, 'debug-agent');
    chat = await env.connect(chatId);

    await env.sendMessage(
      'clawmini-lite.js subagents spawn --id deliv-manual --delivery manual "echo manual-deliv"',
      { chat: chatId, agent: 'debug-agent' }
    );
    // The spawn announce log should also include the new manual-hint line.
    const announce = await chat.waitForMessage(
      commandMatching(
        (m) =>
          !m.subagentId &&
          m.stdout.includes('Subagent spawned successfully with ID: deliv-manual') &&
          m.stdout.includes('delegations wait deliv-manual') &&
          m.stdout.includes('delegations notify-when deliv-manual')
      )
    );
    expect(announce.exitCode).toBe(0);

    await waitForState(chatId, 'deliv-manual', (r) => r.state === 'completed');
    // Wait a beat to confirm nothing appears.
    await new Promise((r) => setTimeout(r, 500));
    expect(countNotifications(chatId)).toBe(0);

    // The result is observable via `delegations show`.
    await env.sendMessage('clawmini-lite.js delegations show deliv-manual', {
      chat: chatId,
      agent: 'debug-agent',
    });
    const showLog = await chat.waitForMessage(
      commandMatching(
        (m) =>
          !m.subagentId &&
          m.stdout.includes('"id": "deliv-manual"') &&
          m.stdout.includes('"state": "completed"') &&
          m.stdout.includes('"delivery": "manual"')
      ),
      15000
    );
    expect(showLog.exitCode).toBe(0);
  }, 30000);

  it('default delivery for root agent is notify (no --delivery flag)', async () => {
    const chatId = 'deliv-default-root';
    await env.addChat(chatId, 'debug-agent');
    chat = await env.connect(chatId);

    // No --delivery, no --async: should default to notify at depth 0.
    await env.sendMessage(
      'clawmini-lite.js subagents spawn --id deliv-default "echo default-root"',
      { chat: chatId, agent: 'debug-agent' }
    );
    await chat.waitForMessage(
      commandMatching((m) => m.subagentId === 'deliv-default' && m.stdout.includes('default-root'))
    );

    await waitForState(chatId, 'deliv-default', (r) => r.state === 'completed');

    // The on-disk record should show delivery: 'notify'.
    const rec = env.readDelegation(chatId, 'deliv-default') as { delivery?: string } | null;
    expect(rec?.delivery).toBe('notify');
  }, 30000);

  it('default delivery for a nested subagent (depth ≥ 1) is manual; no notification on completion', async () => {
    const chatId = 'deliv-default-nested';
    await env.addChat(chatId, 'debug-agent');
    chat = await env.connect(chatId);

    // Outer subagent (depth 1) spawns inner without --delivery → daemon
    // resolves the default by depth, which is `manual` at depth 1. The
    // inner subagent runs to completion but should NOT append a
    // `<notification>` to the chat.
    await env.sendMessage(
      'clawmini-lite.js subagents spawn --id deliv-outer --delivery notify "clawmini-lite.js subagents spawn --id deliv-inner \\"echo nested-deliv\\""',
      { chat: chatId, agent: 'debug-agent' }
    );

    await chat.waitForMessage(
      commandMatching(
        (m) =>
          !!m.subagentId && m.stdout.includes('Subagent spawned successfully with ID: deliv-inner')
      ),
      30000
    );

    // Wait for the inner to settle.
    await waitForState(chatId, 'deliv-inner', (r) => r.state === 'completed', 30_000);

    // The inner's record should have delivery: 'manual'.
    const innerRec = env.readDelegation(chatId, 'deliv-inner') as { delivery?: string } | null;
    expect(innerRec?.delivery).toBe('manual');

    // The notifications in the chat should belong to the outer subagent
    // (delivery: notify), NOT the inner. Specifically, no notification
    // should be "Subagent deliv-inner completed" — the outer's
    // notification may quote deliv-inner inside its captured stdout (the
    // outer's CLI subprocess spawned deliv-inner and the hint text mentions
    // the id), so we match on the per-id completion line directly.
    const notifs = readChatJsonl(chatId).filter(
      (m) => typeof (m as any).content === 'string' && (m as any).content.includes('<notification>')
    );
    for (const n of notifs) {
      expect((n as any).content).not.toMatch(/Subagent deliv-inner completed/);
    }
  }, 45000);

  it('request <cmd> --delivery manual stores the result without appending a <notification>', async () => {
    const chatId = 'deliv-policy-manual';
    await env.addChat(chatId, 'debug-agent');
    chat = await env.connect(chatId);

    // Auto-approved policy with --delivery manual: the executionResult still
    // flows back to the CLI synchronously (the lite `request` command exits
    // with stdout/stderr/exitCode), but the on-disk record carries
    // delivery: 'manual' and no `<notification>` should land in the chat
    // for the policy.
    await env.sendMessage(
      'clawmini-lite.js request echo-policy --delivery manual && echo POLICY_DONE',
      {
        chat: chatId,
        agent: 'debug-agent',
      }
    );
    const policyLog = await chat.waitForMessage(
      commandMatching(
        (m) => !m.subagentId && m.stdout.includes('delivery-ok') && m.stdout.includes('POLICY_DONE')
      ),
      15000
    );
    expect(policyLog.exitCode).toBe(0);

    // The on-disk record should be a completed policy with delivery: 'manual'.
    const records = env
      .listDelegations(chatId)
      .filter((r) => (r as any).kind === 'policy' && (r as any).delivery === 'manual');
    expect(records.length).toBeGreaterThanOrEqual(1);
    const manualPolicyId = (records[0] as any).id as string;
    expect(typeof manualPolicyId).toBe('string');
    expect((records[0] as any).state).toBe('completed');

    // No `<notification>` lands for the policy.
    await new Promise((r) => setTimeout(r, 300));
    expect(countNotifications(chatId)).toBe(0);

    // `delegations show <id>` returns the executionResult.
    await env.sendMessage(`clawmini-lite.js delegations show ${manualPolicyId}`, {
      chat: chatId,
      agent: 'debug-agent',
    });
    const showLog = await chat.waitForMessage(
      commandMatching(
        (m) =>
          !m.subagentId &&
          m.stdout.includes(`"id": "${manualPolicyId}"`) &&
          m.stdout.includes('"state": "completed"') &&
          m.stdout.includes('"delivery": "manual"') &&
          m.stdout.includes('"executionResult"')
      ),
      15000
    );
    expect(showLog.exitCode).toBe(0);
  }, 30000);

  it('--async still works but emits a deprecation warning on stderr', async () => {
    const chatId = 'deliv-async-deprecated';
    // Run lite directly so we can capture stderr; sendMessage-via-debug-agent
    // swallows stderr framing. We mint chat-scoped credentials so the spawn
    // lands in `chatId` (not the credential-bootstrap chat).
    const creds = await env.getAgentCredentialsForChat(chatId);
    chat = await env.connect(chatId);

    const result = await env.runLite(
      ['subagents', 'spawn', '--id', 'deliv-async-legacy', '--async', 'echo legacy-async'],
      { creds }
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Subagent spawned successfully with ID: deliv-async-legacy');
    // Stderr carries the deprecation warning.
    expect(result.stderr).toContain('--async');
    expect(result.stderr.toLowerCase()).toContain('deprecat');

    // The legacy --async maps to delivery: notify, so eventually a
    // <notification> lands.
    await waitForState(chatId, 'deliv-async-legacy', (r) => r.state === 'completed');
    const start = Date.now();
    while (Date.now() - start < 5_000) {
      if (countNotifications(chatId) >= 1) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    const rec = env.readDelegation(chatId, 'deliv-async-legacy') as { delivery?: string } | null;
    expect(rec?.delivery).toBe('notify');
  }, 30000);
});
