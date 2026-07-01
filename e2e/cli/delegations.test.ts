/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import fs from 'node:fs';
import { createTRPCClient, httpLink } from '@trpc/client';
import { TestEnvironment } from '../_helpers/test-environment.js';
import type { AgentRouter } from '../../src/daemon/api/agent-router.js';
import type { ChatMessage } from '../../src/daemon/chats.js';

// Ticket 6: the `delegations` CLI group surfaces the manager to agents. The
// lite CLI is the user-facing entry point; this test exercises it end-to-end
// with a real daemon. Each `it` uses its own chat so ids never collide and
// observer state stays isolated.

describe('delegations CLI group (e2e)', () => {
  let env: TestEnvironment;

  beforeAll(async () => {
    env = new TestEnvironment('e2e-delegations-cli');
    await env.setup();
    await env.setupSubagentEnv({
      policies: {
        'echo-policy': {
          description: 'Echo a fixed string',
          command: 'echo',
          args: ['ok'],
          autoApprove: true,
        },
      },
    });
  }, 30000);

  afterAll(() => env.teardown(), 30000);
  afterEach(() => env.disconnectAll());

  async function mintAgentClient(chatId: string) {
    const { url, token } = await env.getAgentCredentialsForChat(chatId);
    return {
      client: createTRPCClient<AgentRouter>({
        links: [httpLink({ url, headers: () => ({ Authorization: `Bearer ${token}` }) })],
      }),
      creds: { url, token },
    };
  }

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
    timeoutMs = 10_000
  ): Promise<Record<string, unknown>> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const rec = env.readDelegation(chatId, id);
      if (rec && predicate(rec)) return rec;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`Timed out waiting for delegation ${id} in chat ${chatId}`);
  }

  it('list returns pending+running by default; --state and --kind filter; --json prints raw', async () => {
    const chatId = 'del-list';
    await env.addChat(chatId, 'debug-agent');
    await env.connect(chatId);
    const { client, creds } = await mintAgentClient(chatId);

    // Spawn one quick subagent (will settle to completed) and one slow one
    // (stays running). Plus an auto-approved policy (settles to completed).
    const fast = await client.subagentSpawn.mutate({
      prompt: 'echo fast-done',
      delivery: 'manual',
    });
    const slow = await client.subagentSpawn.mutate({
      prompt: 'sleep 30 && echo never',
      delivery: 'manual',
    });
    const pol = await client.createPolicyRequest.mutate({
      commandName: 'echo-policy',
      args: [],
      fileMappings: {},
    });
    // Wait for fast to settle.
    await waitForState(chatId, fast.id, (r) => r.state === 'completed', 15_000);

    // Default = pending + running. Should include the slow subagent, not the
    // completed ones.
    const def = await env.runLite(['delegations', 'list', '--json'], { creds });
    expect(def.code).toBe(0);
    const defRecs = JSON.parse(def.stdout);
    const defIds = defRecs.map((d: { id: string }) => d.id);
    expect(defIds).toContain(slow.id);
    expect(defIds).not.toContain(fast.id);
    expect(defIds).not.toContain(pol.id);

    // --state resolved returns the terminal ones.
    const resolved = await env.runLite(
      ['delegations', 'list', '--state', 'resolved', '--json'],
      { creds }
    );
    expect(resolved.code).toBe(0);
    const resolvedIds = JSON.parse(resolved.stdout).map((d: { id: string }) => d.id);
    expect(resolvedIds).toContain(fast.id);
    expect(resolvedIds).toContain(pol.id);
    expect(resolvedIds).not.toContain(slow.id);

    // --kind subagent excludes the policy.
    const subOnly = await env.runLite(
      ['delegations', 'list', '--state', 'resolved', '--kind', 'subagent', '--json'],
      { creds }
    );
    const subOnlyIds = JSON.parse(subOnly.stdout).map((d: { id: string }) => d.id);
    expect(subOnlyIds).toContain(fast.id);
    expect(subOnlyIds).not.toContain(pol.id);

    // --kind policy excludes the subagent.
    const polOnly = await env.runLite(
      ['delegations', 'list', '--state', 'resolved', '--kind', 'policy', '--json'],
      { creds }
    );
    const polOnlyIds = JSON.parse(polOnly.stdout).map((d: { id: string }) => d.id);
    expect(polOnlyIds).toContain(pol.id);
    expect(polOnlyIds).not.toContain(fast.id);
  }, 60000);

  it('wait <id> prints {resolved, pending} for a single id with sync default', async () => {
    const chatId = 'del-wait-single';
    await env.addChat(chatId, 'debug-agent');
    await env.connect(chatId);
    const { client, creds } = await mintAgentClient(chatId);

    const spawn = await client.subagentSpawn.mutate({
      prompt: 'sleep 1 && echo wait-single',
      delivery: 'manual',
    });

    const result = await env.runLite(
      ['delegations', 'wait', spawn.id, '--timeout', '15'],
      { creds }
    );
    expect(result.code).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.pending).toEqual([]);
    expect(parsed.resolved).toHaveLength(1);
    expect(parsed.resolved[0].id).toBe(spawn.id);
    expect(parsed.resolved[0].state).toBe('completed');
  }, 60000);

  it('wait <a> <b> <c> --all waits until all three resolve', async () => {
    const chatId = 'del-wait-all';
    await env.addChat(chatId, 'debug-agent');
    await env.connect(chatId);
    const { client, creds } = await mintAgentClient(chatId);

    const ids: string[] = [];
    for (const sleep of [0.2, 0.5, 1.0]) {
      const r = await client.subagentSpawn.mutate({
        prompt: `sleep ${sleep} && echo ok`,
        delivery: 'manual',
      });
      ids.push(r.id);
    }

    const started = Date.now();
    const result = await env.runLite(['delegations', 'wait', ...ids, '--all'], { creds });
    const elapsed = Date.now() - started;
    expect(result.code).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.resolved).toHaveLength(3);
    expect(parsed.pending).toEqual([]);
    expect(elapsed).toBeGreaterThan(800);
  }, 30000);

  it('wait --subscribe prints {subscriptionId}; one <notification> fires when all resolve', async () => {
    const chatId = 'del-wait-subscribe';
    await env.addChat(chatId, 'debug-agent');
    await env.connect(chatId);
    const { client, creds } = await mintAgentClient(chatId);

    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const r = await client.subagentSpawn.mutate({
        prompt: `sleep 0.5 && echo sub-${i}`,
        delivery: 'manual',
      });
      ids.push(r.id);
    }

    const sub = await env.runLite(
      ['delegations', 'wait', ...ids, '--subscribe', '--all'],
      { creds }
    );
    expect(sub.code).toBe(0);
    const parsed = JSON.parse(sub.stdout);
    expect(typeof parsed.subscriptionId).toBe('string');
    expect(parsed.subscriptionId).toMatch(/^sub-/);

    for (const id of ids) await waitForState(chatId, id, (r) => r.state === 'completed', 15_000);
    await new Promise((r) => setTimeout(r, 300));
    expect(countNotifications(chatId)).toBe(1);
  }, 30000);

  it('notify-when is an alias for wait --subscribe --all', async () => {
    const chatId = 'del-notify-when';
    await env.addChat(chatId, 'debug-agent');
    await env.connect(chatId);
    const { client, creds } = await mintAgentClient(chatId);

    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const r = await client.subagentSpawn.mutate({
        prompt: `sleep 0.4 && echo nw-${i}`,
        delivery: 'manual',
      });
      ids.push(r.id);
    }

    const sub = await env.runLite(['delegations', 'notify-when', ...ids, '--all'], { creds });
    expect(sub.code).toBe(0);
    const parsed = JSON.parse(sub.stdout);
    expect(parsed.subscriptionId).toMatch(/^sub-/);

    for (const id of ids) await waitForState(chatId, id, (r) => r.state === 'completed', 15_000);
    await new Promise((r) => setTimeout(r, 300));
    expect(countNotifications(chatId)).toBe(1);
  }, 30000);

  it('unsubscribe removes the file; a second call exits non-zero', async () => {
    const chatId = 'del-unsubscribe';
    await env.addChat(chatId, 'debug-agent');
    await env.connect(chatId);
    const { client, creds } = await mintAgentClient(chatId);

    const spawn = await client.subagentSpawn.mutate({
      prompt: 'sleep 30 && echo never',
      delivery: 'manual',
    });
    const reg = await client.delegationWait.mutate({
      ids: [spawn.id],
      mode: 'all',
      return: 'subscribe',
    });
    if (reg.kind !== 'subscribe') throw new Error('expected subscribe');
    const subId = reg.subscriptionId;
    const subFile = env.getClawminiPath(
      'tmp',
      'delegations',
      chatId,
      'subscriptions',
      `${subId}.json`
    );
    expect(fs.existsSync(subFile)).toBe(true);

    const first = await env.runLite(['delegations', 'unsubscribe', subId], { creds });
    expect(first.code).toBe(0);
    expect(first.stdout.trim()).toContain('ok');
    expect(fs.existsSync(subFile)).toBe(false);

    // Clean up the still-running subagent before next test boundary.
    await client.subagentStop.mutate({ subagentId: spawn.id });
    // A second unsubscribe is a no-op on the daemon (no error there) but per
    // the ticket we expect non-zero. The daemon currently returns success for
    // missing subscriptions, so the CLI alone can't distinguish — give the
    // CLI a chance to return non-zero by skipping when not implemented.
    // (Note: the spec requires this; we implement by making unsubscribe error
    // when no record exists.)
    const second = await env.runLite(['delegations', 'unsubscribe', subId], { creds });
    expect(second.code).not.toBe(0);
  }, 30000);

  it('show <id> prints the full record (both kinds)', async () => {
    const chatId = 'del-show';
    await env.addChat(chatId, 'debug-agent');
    await env.connect(chatId);
    const { client, creds } = await mintAgentClient(chatId);

    const spawn = await client.subagentSpawn.mutate({
      prompt: 'echo show-sub',
      delivery: 'manual',
    });
    await waitForState(chatId, spawn.id, (r) => r.state === 'completed', 15_000);

    const subRes = await env.runLite(['delegations', 'show', spawn.id], { creds });
    expect(subRes.code).toBe(0);
    const subRec = JSON.parse(subRes.stdout);
    expect(subRec.id).toBe(spawn.id);
    expect(subRec.kind).toBe('subagent');
    expect(subRec.state).toBe('completed');
    expect(subRec.delivery).toBe('manual');

    const pol = await client.createPolicyRequest.mutate({
      commandName: 'echo-policy',
      args: [],
      fileMappings: {},
    });
    const polRes = await env.runLite(['delegations', 'show', pol.id], { creds });
    expect(polRes.code).toBe(0);
    const polRec = JSON.parse(polRes.stdout);
    expect(polRec.id).toBe(pol.id);
    expect(polRec.kind).toBe('policy');
    expect(polRec.state).toBe('completed');
    expect(polRec.executionResult).toBeDefined();
    expect(polRec.executionResult.stdout).toContain('ok');
  }, 30000);

  it('delete <id> removes the record (and stops a running subagent); refuses while a subscription covers it', async () => {
    const chatId = 'del-delete';
    await env.addChat(chatId, 'debug-agent');
    await env.connect(chatId);
    const { client, creds } = await mintAgentClient(chatId);

    // 1. delete refuses while a subscription covers the id.
    const longRunning = await client.subagentSpawn.mutate({
      prompt: 'sleep 30 && echo never',
      delivery: 'manual',
    });
    const reg = await client.delegationWait.mutate({
      ids: [longRunning.id],
      mode: 'all',
      return: 'subscribe',
    });
    if (reg.kind !== 'subscribe') throw new Error('expected subscribe');

    const blocked = await env.runLite(['delegations', 'delete', longRunning.id], { creds });
    expect(blocked.code).not.toBe(0);
    expect(blocked.stderr.toLowerCase()).toContain('unsubscribe first');
    expect(env.readDelegation(chatId, longRunning.id)).not.toBeNull();

    // After unsubscribe, delete works and the subagent is stopped.
    await client.delegationUnsubscribe.mutate({ subscriptionId: reg.subscriptionId });
    const okDelete = await env.runLite(['delegations', 'delete', longRunning.id], { creds });
    expect(okDelete.code).toBe(0);
    expect(env.readDelegation(chatId, longRunning.id)).toBeNull();

    // 2. delete works for a completed record too.
    const done = await client.subagentSpawn.mutate({
      prompt: 'echo done-delete',
      delivery: 'manual',
    });
    await waitForState(chatId, done.id, (r) => r.state === 'completed', 15_000);
    const okDelete2 = await env.runLite(['delegations', 'delete', done.id], { creds });
    expect(okDelete2.code).toBe(0);
    expect(env.readDelegation(chatId, done.id)).toBeNull();
  }, 30000);

  it('subagents wait/list/delete are no longer registered as commands', async () => {
    const chatId = 'del-removed-commands';
    await env.addChat(chatId, 'debug-agent');
    await env.connect(chatId);
    const { creds } = await mintAgentClient(chatId);

    for (const cmd of [
      ['subagents', 'wait', 'whatever'],
      ['subagents', 'list'],
      ['subagents', 'delete', 'whatever'],
    ]) {
      const res = await env.runLite(cmd, { creds });
      expect(res.code).not.toBe(0);
      // Commander emits its own "unknown command" message on stderr by default.
      expect(res.stderr.toLowerCase()).toMatch(/unknown command|unknown option/);
    }
  }, 30000);
});
