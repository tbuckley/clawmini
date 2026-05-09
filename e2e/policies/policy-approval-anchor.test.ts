/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TestEnvironment, policyWith } from '../_helpers/test-environment.js';

/**
 * Regression test for the policy-approval activity-log anchor.
 *
 * When a user approves a policy via a Discord button, the adapter passes the
 * policy card's message id as `externalRef` so the resulting `policy_approved`
 * turn opens an activity-log thread on the card. The plumbing depends on
 * `slash-policies.ts` forwarding `state.externalRef` into the inner
 * `executeDirectMessage` call — without it, `emitTurnStarted` fires with no
 * anchor and the adapter has nothing to thread on.
 *
 * Hitting the daemon directly via TRPC keeps this test independent of the
 * Discord transport: we observe the raw `kind: 'turn'` envelope on the
 * subscription and assert the anchor id rides through.
 */
describe('Policy approval externalRef anchor (e2e)', () => {
  let env: TestEnvironment;

  beforeAll(async () => {
    env = new TestEnvironment('e2e-policy-anchor');
    await env.setup();
    await env.setupSubagentEnv({
      policies: {
        'echo-policy': {
          description: 'Echoes a fixed string for the e2e anchor test',
          command: 'echo',
          args: ['ok'],
        },
      },
    });
  }, 30000);

  afterAll(() => env.teardown(), 30000);

  it('forwards the /approve externalRef into the resulting turn', async () => {
    await env.addChat('chat-anchor');

    // Subscribe directly via TRPC so we can observe the raw `kind: 'turn'`
    // envelopes — the helper's `connect()` strips them. We collect everything
    // and post-filter in assertions.
    await (env as any).ensureTrpcClient();
    const trpc = env.trpcClient!;
    type Envelope =
      | { kind: 'message'; message: any }
      | { kind: 'turn'; event: any };
    const envelopes: Envelope[] = [];
    const sub = trpc.waitForMessages.subscribe(
      { chatId: 'chat-anchor' },
      {
        onData: (items: unknown) => {
          for (const item of items as Envelope[]) envelopes.push(item);
        },
        onError: (err) => console.error('Subscription error:', err),
      }
    );

    try {
      // Phase 1: have the agent create a policy request via clawmini-lite,
      // matching the existing slash-policies e2e harness.
      await env.sendMessage('clawmini-lite.js request echo-policy --async', {
        chat: 'chat-anchor',
        agent: 'debug-agent',
      });

      const reqMsg = await waitFor(
        envelopes,
        (e): e is Extract<Envelope, { kind: 'message' }> =>
          e.kind === 'message' && policyWith()(e.message),
        15000
      );
      const reqId = (reqMsg.message as any).requestId as string;

      // Phase 2: send /approve via TRPC with an explicit externalRef. The
      // CLI doesn't expose --external-ref, so we go straight to the daemon.
      const cardId = 'discord-card-msg-anchor-1';
      await trpc.sendMessage.mutate({
        type: 'send-message',
        client: 'cli',
        data: {
          message: `/approve ${reqId}`,
          chatId: 'chat-anchor',
          adapter: 'cli',
          noWait: true,
          externalRef: cardId,
        },
      });

      // Phase 3: wait for the post-approval turn-started event and assert it
      // carries our externalRef. The turn that approves the request itself
      // (the /approve command) plus the post-approval feedback turn both fire
      // — we accept either, since both should anchor on the same card.
      await waitFor(
        envelopes,
        (e): e is Extract<Envelope, { kind: 'turn' }> =>
          e.kind === 'turn' &&
          e.event?.type === 'started' &&
          e.event?.externalRef === cardId,
        15000
      );

      const matchingTurns = envelopes.filter(
        (e) => e.kind === 'turn' && e.event?.type === 'started' && e.event?.externalRef === cardId
      );
      expect(matchingTurns.length).toBeGreaterThanOrEqual(1);
    } finally {
      sub.unsubscribe();
    }
  }, 30000);
});

async function waitFor<T, U extends T>(
  buf: T[],
  predicate: (item: T) => item is U,
  timeoutMs: number
): Promise<U>;
async function waitFor<T>(
  buf: T[],
  predicate: (item: T) => boolean,
  timeoutMs: number
): Promise<T>;
async function waitFor<T>(
  buf: T[],
  predicate: (item: T) => boolean,
  timeoutMs: number
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = buf.find(predicate);
    if (found) return found;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}
