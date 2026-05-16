/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import fs from 'node:fs';
import { createTRPCClient, httpLink } from '@trpc/client';
import { TestEnvironment } from '../_helpers/test-environment.js';
import type { AgentRouter } from '../../src/daemon/api/agent-router.js';
import type { SystemMessage, ChatMessage } from '../../src/daemon/chats.js';

// Ticket 5: `DelegationManager.wait` (sync + subscribe) + notify-suppression.
// CLI surface (`delegations wait <id>`) lands in Ticket 6; for now we drive
// the daemon's tRPC endpoints directly via the agent client, mirroring the
// pattern used in `policies-context-cwd.test.ts`.
//
// `--delivery manual|notify` lands on the CLI in Ticket 7 — until then we
// also exercise `delivery` via the tRPC layer (`subagentSpawn` already
// accepts it; we extend `createPolicyRequest` similarly).

describe('Delegation wait + subscription (e2e)', () => {
  let env: TestEnvironment;
  let agentClient: ReturnType<typeof createTRPCClient<AgentRouter>>;

  beforeAll(async () => {
    env = new TestEnvironment('e2e-delegation-wait');
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

  // Mint an agent client scoped to `chatId`. Each test uses its own chat so
  // delegation ids never collide and observer state stays isolated.
  async function mintAgentClient(chatId: string) {
    const { url, token } = await env.getAgentCredentialsForChat(chatId);
    return createTRPCClient<AgentRouter>({
      links: [httpLink({ url, headers: () => ({ Authorization: `Bearer ${token}` }) })],
    });
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

  it('sync wait on a single id blocks until completion', async () => {
    const chatId = 'wait-sync-single';
    await env.addChat(chatId, 'debug-agent');
    await env.connect(chatId);
    agentClient = await mintAgentClient(chatId);

    const spawn = await agentClient.subagentSpawn.mutate({
      prompt: 'sleep 1 && echo single-done',
      delivery: 'manual',
    });

    const result = await agentClient.delegationWait.mutate({
      ids: [spawn.id],
      mode: 'any',
      return: 'sync',
      timeoutMs: 15_000,
    });
    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') throw new Error('expected sync');
    expect(result.resolved).toHaveLength(1);
    expect(result.resolved[0]!.id).toBe(spawn.id);
    expect(result.resolved[0]!.state).toBe('completed');
    expect(result.pending).toHaveLength(0);
  }, 30000);

  it('sync wait times out and reports pending (delivery=manual, no later wakeup)', async () => {
    const chatId = 'wait-sync-timeout';
    await env.addChat(chatId, 'debug-agent');
    await env.connect(chatId);
    agentClient = await mintAgentClient(chatId);

    const spawn = await agentClient.subagentSpawn.mutate({
      prompt: 'sleep 30 && echo never',
      delivery: 'manual',
    });

    const result = await agentClient.delegationWait.mutate({
      ids: [spawn.id],
      mode: 'any',
      return: 'sync',
      timeoutMs: 500,
    });
    if (result.kind !== 'sync') throw new Error('expected sync');
    expect(result.resolved).toHaveLength(0);
    expect(result.pending).toHaveLength(1);
    expect(result.pending[0]!.state).toBe('running');

    // The subagent is still running and delivery is manual — no late notification.
    await new Promise((r) => setTimeout(r, 600));
    const before = countNotifications(chatId);

    await agentClient.subagentStop.mutate({ subagentId: spawn.id });
    await waitForState(chatId, spawn.id, (r) => r.state === 'failed');
    // Stop doesn't fire a `<notification>` either.
    expect(countNotifications(chatId)).toBe(before);
  }, 30000);

  it('sync wait mode=all only returns after the slowest finishes', async () => {
    const chatId = 'wait-sync-all';
    await env.addChat(chatId, 'debug-agent');
    await env.connect(chatId);
    agentClient = await mintAgentClient(chatId);

    const ids: string[] = [];
    for (const sleep of [0.2, 0.5, 1.0]) {
      const r = await agentClient.subagentSpawn.mutate({
        prompt: `sleep ${sleep} && echo ok`,
        delivery: 'manual',
      });
      ids.push(r.id);
    }

    const start = Date.now();
    const result = await agentClient.delegationWait.mutate({
      ids,
      mode: 'all',
      return: 'sync',
      timeoutMs: 15_000,
    });
    const elapsed = Date.now() - start;
    if (result.kind !== 'sync') throw new Error('expected sync');
    expect(result.resolved).toHaveLength(3);
    expect(result.pending).toHaveLength(0);
    // Slowest is ~1s; we should have waited at least most of that.
    expect(elapsed).toBeGreaterThan(800);
  }, 30000);

  it('subscription mode=all fires exactly one <notification>', async () => {
    const chatId = 'wait-sub-all';
    await env.addChat(chatId, 'debug-agent');
    await env.connect(chatId);
    agentClient = await mintAgentClient(chatId);

    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await agentClient.subagentSpawn.mutate({
        prompt: `echo sub-all-${i}`,
        delivery: 'manual',
      });
      ids.push(r.id);
    }

    const sub = await agentClient.delegationWait.mutate({
      ids,
      mode: 'all',
      return: 'subscribe',
    });
    expect(sub.kind).toBe('subscribe');
    if (sub.kind !== 'subscribe') throw new Error('expected subscribe');
    expect(sub.subscriptionId).toMatch(/^sub-/);

    // Wait for all three to settle.
    for (const id of ids) await waitForState(chatId, id, (r) => r.state === 'completed', 15_000);
    // Allow time for the subscription to fire.
    await new Promise((r) => setTimeout(r, 200));

    expect(countNotifications(chatId)).toBe(1);
    const notif = readChatJsonl(chatId).find(
      (m) =>
        typeof (m as any).content === 'string' && (m as any).content.includes('<notification>')
    ) as SystemMessage | undefined;
    expect(notif).toBeDefined();
    expect(notif!.role).toBe('system');
    expect(notif!.content).toContain("mode: 'all'");
    for (const id of ids) expect(notif!.content).toContain(id);
  }, 30000);

  it('notify-mode subagents covered by a subscription produce exactly one wakeup', async () => {
    const chatId = 'wait-sub-notify-suppress';
    await env.addChat(chatId, 'debug-agent');
    await env.connect(chatId);
    agentClient = await mintAgentClient(chatId);

    const ids: string[] = [];
    // Spawn delivery=notify subagents that sleep long enough that we can
    // race the subscription register in before any of them resolves. With
    // a covering observer in place each resolution sets `wasCovered=true`,
    // so the per-id <notification> is suppressed. Final: only the
    // subscription's aggregated wakeup lands.
    for (let i = 0; i < 3; i++) {
      const r = await agentClient.subagentSpawn.mutate({
        prompt: `sleep 2 && echo notify-${i}`,
        delivery: 'notify',
      });
      ids.push(r.id);
    }
    // Register before the subagents finish.
    const sub = await agentClient.delegationWait.mutate({
      ids,
      mode: 'all',
      return: 'subscribe',
    });
    if (sub.kind !== 'subscribe') throw new Error('expected subscribe');

    for (const id of ids) await waitForState(chatId, id, (r) => r.state === 'completed', 15_000);
    await new Promise((r) => setTimeout(r, 400));

    // Exactly one <notification> — the subscription's aggregated wakeup.
    expect(countNotifications(chatId)).toBe(1);
  }, 30000);

  it('unsubscribe discards the subscription and revives notify behavior for remaining members', async () => {
    const chatId = 'wait-unsub-revive';
    await env.addChat(chatId, 'debug-agent');
    await env.connect(chatId);
    agentClient = await mintAgentClient(chatId);

    // One long-running notify subagent. Register a subscription, then
    // unsubscribe before it resolves — the subagent's own per-id
    // notification should fire when it later completes.
    const spawn = await agentClient.subagentSpawn.mutate({
      prompt: 'sleep 1 && echo unsub-content',
      delivery: 'notify',
    });

    const sub = await agentClient.delegationWait.mutate({
      ids: [spawn.id],
      mode: 'all',
      return: 'subscribe',
    });
    if (sub.kind !== 'subscribe') throw new Error('expected subscribe');

    // Unsubscribe immediately.
    await agentClient.delegationUnsubscribe.mutate({ subscriptionId: sub.subscriptionId });
    // Subscription file is gone.
    const subFile = env.getClawminiPath(
      'tmp',
      'delegations',
      chatId,
      'subscriptions',
      `${sub.subscriptionId}.json`
    );
    expect(fs.existsSync(subFile)).toBe(false);

    // The notify-mode subagent will run to completion; its per-id
    // notification should fire as if no observer ever existed.
    await waitForState(chatId, spawn.id, (r) => r.state === 'completed', 15_000);
    // Give the post-resolve notification path a beat to land.
    const start = Date.now();
    while (Date.now() - start < 5_000) {
      if (countNotifications(chatId) >= 1) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(countNotifications(chatId)).toBeGreaterThanOrEqual(1);
  }, 30000);

  it('subscription covering mixed kinds (subagents + auto-policy) fires once and includes all ids', async () => {
    const chatId = 'wait-mixed-kinds';
    await env.addChat(chatId, 'debug-agent');
    await env.connect(chatId);
    agentClient = await mintAgentClient(chatId);

    const subIds: string[] = [];
    for (let i = 0; i < 2; i++) {
      const r = await agentClient.subagentSpawn.mutate({
        prompt: `sleep 0.3 && echo mix-${i}`,
        delivery: 'manual',
      });
      subIds.push(r.id);
    }

    // Auto-approved policy resolves inline (synchronously). Register the
    // subscription AFTER the policy resolved — the subscription's `members`
    // list will include the policy id and we'll hydrate it via the registry's
    // fast-path. We need to find the policy id first (echo-policy).
    const polReq = await agentClient.createPolicyRequest.mutate({
      commandName: 'echo-policy',
      args: [],
      fileMappings: {},
    });
    const polId = (polReq as { id: string }).id;
    expect(polReq.executionResult).toBeDefined();

    const sub = await agentClient.delegationWait.mutate({
      ids: [...subIds, polId],
      mode: 'all',
      return: 'subscribe',
    });
    if (sub.kind !== 'subscribe') throw new Error('expected subscribe');

    for (const id of subIds) await waitForState(chatId, id, (r) => r.state === 'completed', 15_000);
    // Allow the subscription to fire (policy was already terminal at register-time;
    // the registry hydrates terminal members on subscription-fire path is not
    // implemented — we rely on the subscription firing when subagent #2 resolves
    // because all three become terminal by then).
    // To force the registry to re-check on resolve, we resolve the subagents
    // *after* the subscription is registered (above), so when the last
    // subagent's markResolved fires, the policy is already terminal in the
    // members map only if a resolved-event was emitted for it. Since the policy
    // was auto-approved BEFORE register, no observer captured it. We expect
    // the wakeup to fail to fire here.
    //
    // To work around this in our test, we cycle: spawn subagents AFTER policy,
    // register sub AFTER policy is auto-resolved (already terminal). When the
    // FIRST subagent resolves, all members would be terminal IF we hydrate the
    // policy at register time. Verify behavior by checking notification count.
    await new Promise((r) => setTimeout(r, 400));
    expect(countNotifications(chatId)).toBe(1);
    const notif = readChatJsonl(chatId).find(
      (m) =>
        typeof (m as any).content === 'string' && (m as any).content.includes('<notification>')
    ) as SystemMessage | undefined;
    for (const id of [...subIds, polId]) expect(notif!.content).toContain(id);
  }, 40000);

  it('subscription fires into the original session id even after /new', async () => {
    const chatId = 'wait-session-stamp';
    await env.addChat(chatId, 'debug-agent');
    await env.connect(chatId);
    agentClient = await mintAgentClient(chatId);

    const spawn = await agentClient.subagentSpawn.mutate({
      prompt: 'sleep 1 && echo origin-session',
      delivery: 'manual',
    });
    const sub = await agentClient.delegationWait.mutate({
      ids: [spawn.id],
      mode: 'all',
      return: 'subscribe',
    });
    if (sub.kind !== 'subscribe') throw new Error('expected subscribe');

    // The subscription file should pin the original session id captured at
    // register time.
    const subFile = env.getClawminiPath(
      'tmp',
      'delegations',
      chatId,
      'subscriptions',
      `${sub.subscriptionId}.json`
    );
    const subRecord = JSON.parse(fs.readFileSync(subFile, 'utf8'));
    const originSession = subRecord.originSessionId;
    expect(typeof originSession).toBe('string');

    // Rotate the chat's session via `/new`.
    await env.sendMessage('/new', { chat: chatId, agent: 'debug-agent' });

    await waitForState(chatId, spawn.id, (r) => r.state === 'completed', 15_000);
    await new Promise((r) => setTimeout(r, 400));

    const notif = readChatJsonl(chatId).find(
      (m) =>
        typeof (m as any).content === 'string' && (m as any).content.includes('<notification>')
    ) as SystemMessage | undefined;
    expect(notif).toBeDefined();
    expect(notif!.sessionId).toBe(originSession);
  }, 40000);
});
