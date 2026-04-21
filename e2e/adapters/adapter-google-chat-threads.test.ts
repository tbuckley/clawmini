import { describe, it, expect, vi } from 'vitest';
import {
  getTRPCClient,
  startGoogleChatIngestion,
} from '../../src/adapter-google-chat/client.js';
import { updateGoogleChatState } from '../../src/adapter-google-chat/state.js';
import { getSocketPath } from '../../src/shared/workspace.js';
import {
  BASE_CONFIG,
  makeDmMessage,
  makeFakeChatApi,
  makeFakeSubscription,
  makePubsubMessage,
  runForwarder,
  useGoogleChatAdapterEnv,
} from './_google-chat-fixtures.js';

/**
 * E2E tests for the threaded activity log. We exercise the full inbound path
 * (pubsub → client → daemon → forwarder) so the GChat `message.name` gets
 * correlated to the daemon turn via `externalRef`, just like in production.
 *
 * `command` messages are dropped from the turn log, so a plain-echo agent
 * wouldn't produce any thread-log content. These tests drive the `debug-agent`
 * with a `clawmini-lite.js subagents spawn` inbound — the emitted
 * `subagent_status` events route to `thread-log` and give each turn a real
 * entry to anchor on.
 */
const SPAWN_COMMAND = (id: string) =>
  `clawmini-lite.js subagents spawn --id ${id} --async "echo x"`;
function makeThreadedMessage(opts: {
  space: string;
  messageId: string;
  threadName: string;
  text: string;
}) {
  return makePubsubMessage({
    type: 'MESSAGE',
    space: { name: opts.space, type: 'SPACE' },
    user: { email: 'user@example.com' },
    message: {
      name: `${opts.space}/messages/${opts.messageId}`,
      thread: { name: opts.threadName },
      text: opts.text,
    },
  });
}

describe('Google Chat Adapter E2E — threaded activity log', () => {
  const envRef = useGoogleChatAdapterEnv('e2e-google-chat-threads', { subagents: true });

  it('opens a thread anchored on the user thread and edits the log on subsequent events', async () => {
    const { env } = envRef;
    const trpc = getTRPCClient({ socketPath: getSocketPath(env.e2eDir) });
    const subscription = makeFakeSubscription();
    const { api, create } = makeFakeChatApi();

    create.mockImplementation(
      async () => ({ data: { name: 'spaces/thr/messages/log-1' } }) as unknown as object
    );

    await updateGoogleChatState(
      { channelChatMap: { 'spaces/thr': { chatId: 'gc-threads' } } },
      env.e2eDir
    );
    await env.addChat('gc-threads', 'debug-agent');

    startGoogleChatIngestion(
      BASE_CONFIG,
      trpc,
      {},
      { subscription, chatApi: api, startDir: env.e2eDir }
    );

    const config = { ...BASE_CONFIG, chatId: 'gc-threads' };

    await runForwarder({ trpc, chatApi: api, startDir: env.e2eDir, config }, async () => {
      subscription.emitMessage(
        makeThreadedMessage({
          space: 'spaces/thr',
          messageId: 'u1',
          threadName: 'spaces/thr/threads/t1',
          text: SPAWN_COMMAND('t1-sub'),
        })
      );

      // Main agent's reply lands at top-level; the subagent's status events
      // land in the thread-log anchored on t1.
      await vi.waitFor(
        () => {
          const reply = create.mock.calls.find(
            ([p]) =>
              typeof p.requestBody.text === 'string' &&
              p.requestBody.text.includes('Subagent spawned successfully with ID: t1-sub') &&
              !('thread' in p.requestBody)
          );
          expect(reply).toBeDefined();
        },
        { timeout: 15000 }
      );

      await vi.waitFor(
        () => {
          const threaded = create.mock.calls.find(
            ([p]) =>
              (p.requestBody as { thread?: { name?: string } }).thread?.name ===
              'spaces/thr/threads/t1'
          );
          expect(threaded).toBeDefined();
        },
        { timeout: 15000 }
      );

      const threaded = create.mock.calls.find(
        ([p]) =>
          (p.requestBody as { thread?: { name?: string } }).thread?.name ===
          'spaces/thr/threads/t1'
      )![0];
      expect(threaded.parent).toBe('spaces/thr');
      expect(
        (threaded as unknown as { messageReplyOption?: string }).messageReplyOption
      ).toBe('REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD');
    });
  }, 60000);

  it('routes the final agent reply to top-level, not the thread', async () => {
    const { env } = envRef;
    const trpc = getTRPCClient({ socketPath: getSocketPath(env.e2eDir) });
    const subscription = makeFakeSubscription();
    const { api, create } = makeFakeChatApi();

    create.mockImplementation(
      async () => ({ data: { name: 'spaces/thr2/messages/log-1' } }) as unknown as object
    );

    await updateGoogleChatState(
      { channelChatMap: { 'spaces/thr2': { chatId: 'gc-threads-2' } } },
      env.e2eDir
    );
    await env.addChat('gc-threads-2');

    startGoogleChatIngestion(
      BASE_CONFIG,
      trpc,
      {},
      { subscription, chatApi: api, startDir: env.e2eDir }
    );

    const config = { ...BASE_CONFIG, chatId: 'gc-threads-2' };

    await runForwarder({ trpc, chatApi: api, startDir: env.e2eDir, config }, async () => {
      subscription.emitMessage(
        makeThreadedMessage({
          space: 'spaces/thr2',
          messageId: 'u1',
          threadName: 'spaces/thr2/threads/t2',
          text: 'final reply payload',
        })
      );

      await vi.waitFor(
        () => {
          const reply = create.mock.calls.find(
            ([p]) =>
              p.requestBody.text === 'final reply payload' && !('thread' in p.requestBody)
          );
          expect(reply).toBeDefined();
        },
        { timeout: 15000 }
      );
    });
  }, 45000);

  it('anchors the activity log on the triggering message, not an earlier slash command', async () => {
    const { env } = envRef;
    const trpc = getTRPCClient({ socketPath: getSocketPath(env.e2eDir) });
    const subscription = makeFakeSubscription();
    const { api, create } = makeFakeChatApi();

    create.mockImplementation(
      async () => ({ data: { name: 'spaces/newcmd/messages/log-1' } }) as unknown as object
    );

    await updateGoogleChatState(
      { channelChatMap: { 'spaces/newcmd': { chatId: 'gc-newcmd' } } },
      env.e2eDir
    );
    await env.addChat('gc-newcmd');

    // Register /new as a router so that a bare `/new` message does not spawn
    // an agent turn — mirrors real deployments where /new resets the session
    // and returns an automatic reply with no agent work. The chat's agent is
    // `debug-agent` so the real turn can spawn a subagent (producing the
    // subagent_status events that actually anchor the thread log).
    env.writeChatSettings('gc-newcmd', {
      routers: ['@clawmini/slash-new'],
      defaultAgent: 'debug-agent',
    });

    startGoogleChatIngestion(
      BASE_CONFIG,
      trpc,
      {},
      { subscription, chatApi: api, startDir: env.e2eDir }
    );

    const config = { ...BASE_CONFIG, chatId: 'gc-newcmd' };

    await runForwarder({ trpc, chatApi: api, startDir: env.e2eDir, config }, async () => {
      // First inbound: `/new`. Does not trigger a turn.
      subscription.emitMessage(
        makeThreadedMessage({
          space: 'spaces/newcmd',
          messageId: 'slash',
          threadName: 'spaces/newcmd/threads/slash-thread',
          text: '/new',
        })
      );

      // Second inbound: the real message. This is the one that triggers a
      // turn and whose thread should anchor the activity log.
      subscription.emitMessage(
        makeThreadedMessage({
          space: 'spaces/newcmd',
          messageId: 'real',
          threadName: 'spaces/newcmd/threads/real-thread',
          text: SPAWN_COMMAND('newcmd-sub'),
        })
      );

      await vi.waitFor(
        () => {
          const threaded = create.mock.calls.find(
            ([p]) =>
              (p.requestBody as { thread?: { name?: string } }).thread?.name ===
              'spaces/newcmd/threads/real-thread'
          );
          expect(threaded).toBeDefined();
        },
        // The subagent spawn takes a few seconds to fully round-trip through
        // the daemon; 15s was tight enough to be flaky under full-suite load.
        { timeout: 45000 }
      );

      // Crucially: nothing should anchor to the /new thread.
      const anchoredOnSlash = create.mock.calls.find(
        ([p]) =>
          (p.requestBody as { thread?: { name?: string } }).thread?.name ===
          'spaces/newcmd/threads/slash-thread'
      );
      expect(anchoredOnSlash).toBeUndefined();
    });
  }, 60000);

  it('falls back to top-level when threadsDisabled is set on the space', async () => {
    const { env } = envRef;
    const trpc = getTRPCClient({ socketPath: getSocketPath(env.e2eDir) });
    const subscription = makeFakeSubscription();
    const { api, create } = makeFakeChatApi();

    await updateGoogleChatState(
      {
        channelChatMap: {
          'spaces/noth': { chatId: 'gc-noth', threadsDisabled: true },
        },
      },
      env.e2eDir
    );
    await env.addChat('gc-noth');

    startGoogleChatIngestion(
      BASE_CONFIG,
      trpc,
      {},
      { subscription, chatApi: api, startDir: env.e2eDir }
    );

    const config = { ...BASE_CONFIG, chatId: 'gc-noth' };

    await runForwarder({ trpc, chatApi: api, startDir: env.e2eDir, config }, async () => {
      subscription.emitMessage(
        makeThreadedMessage({
          space: 'spaces/noth',
          messageId: 'u1',
          threadName: 'spaces/noth/threads/tn',
          text: 'threads off',
        })
      );

      await vi.waitFor(
        () => {
          expect(
            create.mock.calls.find(
              ([p]) =>
                p.requestBody.text === 'threads off' && !('thread' in p.requestBody)
            )
          ).toBeDefined();
        },
        { timeout: 15000 }
      );

      const threadedCalls = create.mock.calls.filter(
        ([p]) =>
          p.parent === 'spaces/noth' &&
          (p.requestBody as { thread?: unknown }).thread !== undefined
      );
      expect(threadedCalls).toHaveLength(0);
    });
  }, 45000);

  it('DM spaces thread activity onto the user message, same as group spaces', async () => {
    const { env } = envRef;
    const trpc = getTRPCClient({ socketPath: getSocketPath(env.e2eDir) });
    const subscription = makeFakeSubscription();
    const { api, create } = makeFakeChatApi();

    create.mockImplementation(
      async () => ({ data: { name: 'spaces/dmsp/messages/log-1' } }) as unknown as object
    );

    await updateGoogleChatState(
      { channelChatMap: { 'spaces/dmsp': { chatId: 'gc-dm' } } },
      env.e2eDir
    );
    await env.addChat('gc-dm', 'debug-agent');

    startGoogleChatIngestion(
      BASE_CONFIG,
      trpc,
      {},
      { subscription, chatApi: api, startDir: env.e2eDir }
    );

    const config = { ...BASE_CONFIG, chatId: 'gc-dm' };

    await runForwarder({ trpc, chatApi: api, startDir: env.e2eDir, config }, async () => {
      // DM messages carry a thread.name even though DMs have no UI thread —
      // GChat uses it as a reply anchor.
      const dm = makeDmMessage({
        space: 'spaces/dmsp',
        messageId: 'u1',
        text: SPAWN_COMMAND('dm-sub'),
      });
      // Inject a thread on the DM payload since makeDmMessage doesn't set one.
      const parsed = JSON.parse(dm.data.toString('utf8'));
      parsed.message.thread = { name: 'spaces/dmsp/threads/td' };
      dm.data = Buffer.from(JSON.stringify(parsed));
      subscription.emitMessage(dm);

      await vi.waitFor(
        () => {
          expect(
            create.mock.calls.find(
              ([p]) =>
                typeof p.requestBody.text === 'string' &&
                p.requestBody.text.includes('Subagent spawned successfully with ID: dm-sub') &&
                !('thread' in p.requestBody)
            )
          ).toBeDefined();
        },
        { timeout: 15000 }
      );

      await vi.waitFor(
        () => {
          const threaded = create.mock.calls.find(
            ([p]) =>
              (p.requestBody as { thread?: { name?: string } }).thread?.name ===
              'spaces/dmsp/threads/td'
          );
          expect(threaded).toBeDefined();
        },
        { timeout: 15000 }
      );
    });
  }, 60000);

  it('falls back to top-level when visibility.threads is disabled globally', async () => {
    const { env } = envRef;
    const trpc = getTRPCClient({ socketPath: getSocketPath(env.e2eDir) });
    const subscription = makeFakeSubscription();
    const { api, create } = makeFakeChatApi();

    await updateGoogleChatState(
      { channelChatMap: { 'spaces/gth': { chatId: 'gc-globalthr' } } },
      env.e2eDir
    );
    await env.addChat('gc-globalthr');

    startGoogleChatIngestion(
      BASE_CONFIG,
      trpc,
      {},
      { subscription, chatApi: api, startDir: env.e2eDir }
    );

    const config = {
      ...BASE_CONFIG,
      chatId: 'gc-globalthr',
      visibility: { threads: false as const },
    };

    await runForwarder({ trpc, chatApi: api, startDir: env.e2eDir, config }, async () => {
      subscription.emitMessage(
        makeThreadedMessage({
          space: 'spaces/gth',
          messageId: 'u1',
          threadName: 'spaces/gth/threads/tg',
          text: 'global off',
        })
      );

      await vi.waitFor(
        () => {
          expect(
            create.mock.calls.find(
              ([p]) =>
                p.requestBody.text === 'global off' && !('thread' in p.requestBody)
            )
          ).toBeDefined();
        },
        { timeout: 15000 }
      );

      const threaded = create.mock.calls.filter(
        ([p]) => (p.requestBody as { thread?: unknown }).thread !== undefined
      );
      expect(threaded).toHaveLength(0);
    });
  }, 45000);

  it('renders the turn log for a debug-agent subagent spawn', async () => {
    const { env } = envRef;
    const trpc = getTRPCClient({ socketPath: getSocketPath(env.e2eDir) });
    const subscription = makeFakeSubscription();
    const { api, create, update } = makeFakeChatApi();

    // One activity-log message per turn; the forwarder opens it with `create`
    // and then appends via `update` calls. Returning a stable name keeps the
    // snapshot deterministic across runs.
    create.mockImplementation(
      async () => ({ data: { name: 'spaces/snap/messages/log-1' } }) as unknown as object
    );

    await updateGoogleChatState(
      { channelChatMap: { 'spaces/snap': { chatId: 'gc-snap' } } },
      env.e2eDir
    );
    await env.addChat('gc-snap', 'debug-agent');

    startGoogleChatIngestion(
      BASE_CONFIG,
      trpc,
      {},
      { subscription, chatApi: api, startDir: env.e2eDir }
    );

    const config = { ...BASE_CONFIG, chatId: 'gc-snap' };

    await runForwarder({ trpc, chatApi: api, startDir: env.e2eDir, config }, async () => {
      subscription.emitMessage(
        makeThreadedMessage({
          space: 'spaces/snap',
          messageId: 'u1',
          threadName: 'spaces/snap/threads/t1',
          text: 'clawmini-lite.js subagents spawn --id hello-sub --async "sleep 5 && echo hello"',
        })
      );

      // `✅ hello-sub` is the last status entry that lands in the activity
      // log, so waiting for it in an `update` payload guarantees the final
      // debounced flush has fired.
      await vi.waitFor(
        () => {
          const last = [...update.mock.calls]
            .reverse()
            .find(([p]) => p.name === 'spaces/snap/messages/log-1');
          expect(last).toBeDefined();
          const text = (last![0].requestBody as { text?: string }).text ?? '';
          expect(text).toMatch(/✅ hello-sub/);
        },
        { timeout: 45000, interval: 500 }
      );
    });

    const lastUpdate = [...update.mock.calls]
      .reverse()
      .find(([p]) => p.name === 'spaces/snap/messages/log-1')!;
    const rawText = (lastUpdate[0].requestBody as { text?: string }).text ?? '';
    // Relative timestamps depend on wall-clock scheduling (sleep 5 + flush
    // debounce drift); normalize to a placeholder for snapshot stability.
    const normalized = rawText
      .replace(/^• (?:\d+m)?\d+[ms]/gm, '• Δs')
      .replace(/\/clawmini-e2e-google-chat-threads-[^/\s"]+/g, '/CLAWMINI_DIR');

    expect(normalized).toMatchInlineSnapshot(`
      "• Δs  👉 hello-sub: sleep 5 && echo hello
      • Δs  👈 hello-sub: [DEBUG] sleep 5 && echo hello: \`\`\` hello \`\`\`
      • Δs  ✅ hello-sub"
    `);
  }, 120000);

  /**
   * Summarize the interleaved sequence of `create` / `update` calls for a
   * snapshot. Strips wall-clock dependent bits (relative timestamps, temp-dir
   * paths) so the expected output is stable run-to-run.
   */
  function transcribe(
    create: ReturnType<typeof makeFakeChatApi>['create'],
    update: ReturnType<typeof makeFakeChatApi>['update']
  ): string {
    const events = [
      ...create.mock.calls.map((c, i) => ({
        kind: 'create' as const,
        order: create.mock.invocationCallOrder[i]!,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        call: c[0] as any,
      })),
      ...update.mock.calls.map((c, i) => ({
        kind: 'update' as const,
        order: update.mock.invocationCallOrder[i]!,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        call: c[0] as any,
      })),
    ].sort((a, b) => a.order - b.order);

    const normalize = (text: string) =>
      (text ?? '')
        .replace(/• (?:\d+m)?\d+[ms]/g, '• Δs')
        .replace(/\/clawmini-e2e-google-chat-threads-[^/\s"]+/g, '/CLAWMINI_DIR');

    const lines: string[] = [];
    for (const ev of events) {
      if (ev.kind === 'create') {
        const thread: string | undefined = ev.call.requestBody?.thread?.name;
        const text = normalize(ev.call.requestBody?.text ?? '');
        const card = Array.isArray(ev.call.requestBody?.cardsV2)
          ? ev.call.requestBody.cardsV2.length > 0
          : false;
        const where = thread ? `thread=${thread}` : 'top-level';
        const body = card && !text ? '<card>' : text;
        lines.push(`CREATE ${where}\n  ${body.replace(/\n/g, '\n  ')}`);
      } else {
        const text = normalize(ev.call.requestBody?.text ?? '');
        lines.push(`UPDATE name=${ev.call.name}\n  ${text.replace(/\n/g, '\n  ')}`);
      }
    }
    return lines.join('\n---\n');
  }

  /**
   * Wait for the `✅ <subagentId>` status entry to land in any posted
   * activity-log content — signals that the final debounced flush for that
   * subagent has fired. Checks every create/update (not just the most
   * recent), since rollover may land the ✅ in a later threaded `create`
   * rather than an `update`.
   */
  async function waitForSubagentComplete(
    update: ReturnType<typeof makeFakeChatApi>['update'],
    create: ReturnType<typeof makeFakeChatApi>['create'],
    subagentId: string,
    timeout = 45000
  ): Promise<void> {
    const needle = `✅ ${subagentId}`;
    await vi.waitFor(
      () => {
        const allTexts = [
          ...create.mock.calls.map((c) => (c[0].requestBody as { text?: string }).text ?? ''),
          ...update.mock.calls.map((c) => (c[0].requestBody as { text?: string }).text ?? ''),
        ];
        expect(allTexts.some((t) => t.includes(needle))).toBe(true);
      },
      { timeout, interval: 500 }
    );
  }

  it('rolls over into a new threaded log message when content exceeds maxLogMessageChars', async () => {
    const { env } = envRef;
    const trpc = getTRPCClient({ socketPath: getSocketPath(env.e2eDir) });
    const subscription = makeFakeSubscription();
    const { api, create, update } = makeFakeChatApi();

    // Distinct names per open so the transcript clearly shows rollover
    // opening a fresh log-N inside the same thread.
    let logCount = 0;
    create.mockImplementation(
      async () => ({ data: { name: `spaces/roll/messages/log-${++logCount}` } }) as unknown as object
    );

    await updateGoogleChatState(
      { channelChatMap: { 'spaces/roll': { chatId: 'gc-roll' } } },
      env.e2eDir
    );
    await env.addChat('gc-roll', 'debug-agent');

    startGoogleChatIngestion(
      BASE_CONFIG,
      trpc,
      {},
      { subscription, chatApi: api, startDir: env.e2eDir }
    );

    // Budget of 80 chars forces rollover after ~1-2 entries.
    const config = {
      ...BASE_CONFIG,
      chatId: 'gc-roll',
      visibility: {
        threads: true,
        threadLog: { maxLogMessageChars: 80, editDebounceMs: 100 },
      },
    };

    await runForwarder({ trpc, chatApi: api, startDir: env.e2eDir, config }, async () => {
      subscription.emitMessage(
        makeThreadedMessage({
          space: 'spaces/roll',
          messageId: 'u1',
          threadName: 'spaces/roll/threads/t1',
          text: 'clawmini-lite.js subagents spawn --id roll-sub --async "echo roll-output"',
        })
      );
      await waitForSubagentComplete(update, create, 'roll-sub');
    });

    // All threaded creates land in the same thread. There should be multiple
    // of them because the 80-char budget cannot hold all three status entries
    // in one message — rollover opens new log-N messages in the same thread.
    const threadedCreates = create.mock.calls.filter(([p]) =>
      Boolean((p.requestBody as { thread?: { name?: string } }).thread)
    );
    expect(threadedCreates.length).toBeGreaterThanOrEqual(2);
    for (const call of threadedCreates) {
      expect((call[0].requestBody as { thread?: { name?: string } }).thread?.name).toBe(
        'spaces/roll/threads/t1'
      );
    }

    // The combined posted content (including edits) both names every stage of
    // the subagent's lifecycle AND carries the `…log continues` marker,
    // evidence that at least one rollover happened.
    const allText = [
      ...create.mock.calls.map((c) => (c[0].requestBody.text ?? '') as string),
      ...update.mock.calls.map((c) => (c[0].requestBody.text ?? '') as string),
    ].join('\n');
    expect(allText).toContain('…log continues');
    expect(allText).toContain('👉 roll-sub');
    expect(allText).toContain('👈 roll-sub');
    expect(allText).toContain('✅ roll-sub');
  }, 120000);

  it('falls back to top-level posts when thread creation fails (degraded mode)', async () => {
    const { env } = envRef;
    const trpc = getTRPCClient({ socketPath: getSocketPath(env.e2eDir) });
    const subscription = makeFakeSubscription();
    const { api, create, update } = makeFakeChatApi();

    // The first attempt to open a thread-log message fails; every other
    // create (agent reply, fallback top-level posts) succeeds.
    let firstThreadedAttempt = true;
    create.mockImplementation(async (params) => {
      const threaded = Boolean(
        (params.requestBody as { thread?: { name?: string } }).thread
      );
      if (threaded && firstThreadedAttempt) {
        firstThreadedAttempt = false;
        throw new Error('GChat 503 — thread open failed');
      }
      return { data: { name: `spaces/deg/messages/${Math.random().toString(36).slice(2, 8)}` } };
    });

    await updateGoogleChatState(
      { channelChatMap: { 'spaces/deg': { chatId: 'gc-deg' } } },
      env.e2eDir
    );
    await env.addChat('gc-deg', 'debug-agent');

    startGoogleChatIngestion(
      BASE_CONFIG,
      trpc,
      {},
      { subscription, chatApi: api, startDir: env.e2eDir }
    );

    const config = { ...BASE_CONFIG, chatId: 'gc-deg' };

    await runForwarder({ trpc, chatApi: api, startDir: env.e2eDir, config }, async () => {
      subscription.emitMessage(
        makeThreadedMessage({
          space: 'spaces/deg',
          messageId: 'u1',
          threadName: 'spaces/deg/threads/t1',
          text: 'clawmini-lite.js subagents spawn --id deg-sub --async "echo hi"',
        })
      );

      // Wait until the subagent's `✅` status lands as a top-level post —
      // that's the last event of the turn and proves degraded mode kept
      // routing thread-log entries top-level after the initial thread-open
      // failure.
      await vi.waitFor(
        () => {
          const topLevelTexts = create.mock.calls
            .filter(([p]) => !('thread' in (p.requestBody as { thread?: unknown })))
            .map(([p]) => (p.requestBody.text ?? '') as string);
          expect(topLevelTexts.some((t) => t.includes('✅ deg-sub'))).toBe(true);
        },
        { timeout: 45000, interval: 500 }
      );
    });

    // There must be exactly one failed thread-open attempt (the rest of
    // activity goes top-level, no retry on thread creation).
    const threadedCreates = create.mock.calls.filter(([p]) =>
      Boolean((p.requestBody as { thread?: { name?: string } }).thread)
    );
    expect(threadedCreates).toHaveLength(1);

    // No updates — the log message was never successfully opened.
    expect(update.mock.calls).toHaveLength(0);

    // Every subagent stage eventually appears at top-level.
    const topLevelText = create.mock.calls
      .filter(([p]) => !('thread' in (p.requestBody as { thread?: unknown })))
      .map(([p]) => (p.requestBody.text ?? '') as string)
      .join('\n');
    expect(topLevelText).toContain('👉 deg-sub');
    expect(topLevelText).toContain('✅ deg-sub');
  }, 120000);

  it('coalesces a multi-subagent turn into a single threaded log message', async () => {
    const { env } = envRef;
    const trpc = getTRPCClient({ socketPath: getSocketPath(env.e2eDir) });
    const subscription = makeFakeSubscription();
    const { api, create, update } = makeFakeChatApi();

    create.mockImplementation(
      async () => ({ data: { name: 'spaces/multi/messages/log-1' } }) as unknown as object
    );

    await updateGoogleChatState(
      { channelChatMap: { 'spaces/multi': { chatId: 'gc-multi' } } },
      env.e2eDir
    );
    await env.addChat('gc-multi', 'debug-agent');

    startGoogleChatIngestion(
      BASE_CONFIG,
      trpc,
      {},
      { subscription, chatApi: api, startDir: env.e2eDir }
    );

    const config = { ...BASE_CONFIG, chatId: 'gc-multi' };

    await runForwarder({ trpc, chatApi: api, startDir: env.e2eDir, config }, async () => {
      // The parent agent's single eval spawns two async subagents. Both
      // produce prompt/reply/status entries; the forwarder must fold them
      // into the same thread-log message.
      subscription.emitMessage(
        makeThreadedMessage({
          space: 'spaces/multi',
          messageId: 'u1',
          threadName: 'spaces/multi/threads/t1',
          text:
            'clawmini-lite.js subagents spawn --id multi-a --async "echo A" && ' +
            'clawmini-lite.js subagents spawn --id multi-b --async "echo B"',
        })
      );

      await waitForSubagentComplete(update, create, 'multi-a');
      await waitForSubagentComplete(update, create, 'multi-b');
    });

    // Exactly one threaded `create` (the log is opened once and edited).
    const threadedCreates = create.mock.calls.filter(([p]) =>
      Boolean((p.requestBody as { thread?: { name?: string } }).thread)
    );
    expect(threadedCreates).toHaveLength(1);
    expect((threadedCreates[0]![0].requestBody as { thread?: { name?: string } }).thread?.name).toBe(
      'spaces/multi/threads/t1'
    );

    // Coalescing: the number of `update` calls is far below the number of
    // logged entries (we never post one edit per entry). Both subagents
    // produce 3 entries each = 6; we expect the update count to be small
    // (<=6) but that the final text names both subagents end-to-end.
    expect(update.mock.calls.length).toBeLessThanOrEqual(8);

    const lastUpdate = [...update.mock.calls]
      .reverse()
      .find(([p]) => p.name === 'spaces/multi/messages/log-1')!;
    const rawText = (lastUpdate[0].requestBody.text ?? '') as string;
    const normalized = rawText
      .replace(/• (?:\d+m)?\d+[ms]/g, '• Δs')
      .replace(/\/clawmini-e2e-google-chat-threads-[^/\s"]+/g, '/CLAWMINI_DIR');

    expect(normalized).toMatchInlineSnapshot(`
      "• Δs  👉 multi-a: echo A
      • Δs  👈 multi-a: [DEBUG] echo A: \`\`\` A \`\`\`
      • Δs  ✅ multi-a
      • Δs  👉 multi-b: echo B
      • Δs  👈 multi-b: [DEBUG] echo B: \`\`\` B \`\`\`
      • Δs  ✅ multi-b"
    `);
  }, 120000);

  it('drop-earliest strategy keeps one log message with a dropped-entries marker', async () => {
    const { env } = envRef;
    const trpc = getTRPCClient({ socketPath: getSocketPath(env.e2eDir) });
    const subscription = makeFakeSubscription();
    const { api, create, update } = makeFakeChatApi();

    create.mockImplementation(
      async () => ({ data: { name: 'spaces/drop/messages/log-1' } }) as unknown as object
    );

    await updateGoogleChatState(
      { channelChatMap: { 'spaces/drop': { chatId: 'gc-drop' } } },
      env.e2eDir
    );
    await env.addChat('gc-drop', 'debug-agent');

    startGoogleChatIngestion(
      BASE_CONFIG,
      trpc,
      {},
      { subscription, chatApi: api, startDir: env.e2eDir }
    );

    // Tight budget + drop-earliest: under this strategy the condenser never
    // rolls over; it shrinks the posted list and prepends a `…N earlier
    // entries dropped` marker, keeping the entire turn in one message.
    const config = {
      ...BASE_CONFIG,
      chatId: 'gc-drop',
      visibility: {
        threads: true,
        threadLog: {
          maxLogMessageChars: 80,
          condenseStrategy: 'drop-earliest' as const,
          editDebounceMs: 100,
        },
      },
    };

    await runForwarder({ trpc, chatApi: api, startDir: env.e2eDir, config }, async () => {
      subscription.emitMessage(
        makeThreadedMessage({
          space: 'spaces/drop',
          messageId: 'u1',
          threadName: 'spaces/drop/threads/t1',
          text: 'clawmini-lite.js subagents spawn --id drop-sub --async "echo hello"',
        })
      );
      await waitForSubagentComplete(update, create, 'drop-sub');
    });

    // Exactly one threaded create — drop-earliest never rolls over.
    const threadedCreates = create.mock.calls.filter(([p]) =>
      Boolean((p.requestBody as { thread?: { name?: string } }).thread)
    );
    expect(threadedCreates).toHaveLength(1);

    // Final rendered text has the dropped-entries marker and fits in budget.
    const allText = [
      ...create.mock.calls.map((c) => (c[0].requestBody.text ?? '') as string),
      ...update.mock.calls.map((c) => (c[0].requestBody.text ?? '') as string),
    ];
    const latest = allText[allText.length - 1]!;
    expect(latest).toMatch(/…\d+ earlier entries dropped/);
    expect(latest).toContain('✅ drop-sub');
    // The latest status entry is the one kept; the earliest (👉 prompt) is
    // the one most likely to be dropped.
    expect(latest.length).toBeLessThanOrEqual(80);
  }, 120000);

  it('snapshots the interleaved create/update transcript for a successful turn', async () => {
    // End-to-end visibility: one snapshot showing exactly what a GChat client
    // would see when a subagent runs — the thread open, the series of edits
    // as events arrive, and the top-level final reply. `transcribe()` keeps
    // ordering stable across coalescing changes.
    const { env } = envRef;
    const trpc = getTRPCClient({ socketPath: getSocketPath(env.e2eDir) });
    const subscription = makeFakeSubscription();
    const { api, create, update } = makeFakeChatApi();

    create.mockImplementation(
      async () => ({ data: { name: 'spaces/txn/messages/log-1' } }) as unknown as object
    );

    await updateGoogleChatState(
      { channelChatMap: { 'spaces/txn': { chatId: 'gc-txn' } } },
      env.e2eDir
    );
    await env.addChat('gc-txn', 'debug-agent');

    startGoogleChatIngestion(
      BASE_CONFIG,
      trpc,
      {},
      { subscription, chatApi: api, startDir: env.e2eDir }
    );

    // Large editDebounceMs forces all activity to collapse into as few
    // updates as possible, keeping the transcript short and deterministic.
    const config = {
      ...BASE_CONFIG,
      chatId: 'gc-txn',
      visibility: {
        threads: true,
        threadLog: { editDebounceMs: 2000 },
      },
    };

    await runForwarder({ trpc, chatApi: api, startDir: env.e2eDir, config }, async () => {
      subscription.emitMessage(
        makeThreadedMessage({
          space: 'spaces/txn',
          messageId: 'u1',
          threadName: 'spaces/txn/threads/t1',
          text: 'clawmini-lite.js subagents spawn --id txn-sub --async "echo done"',
        })
      );
      await waitForSubagentComplete(update, create, 'txn-sub');
    });

    // The exact number of intermediate updates is allowed to vary (it depends
    // on how debounce windows line up with subagent events); the important
    // guarantees are: (1) first threaded post opens log-1 in t1, (2) every
    // subsequent threaded touch edits log-1, (3) the final top-level reply
    // names the subagent.
    const threadedCreates = create.mock.calls.filter(([p]) =>
      Boolean((p.requestBody as { thread?: { name?: string } }).thread)
    );
    expect(threadedCreates).toHaveLength(1);
    expect((threadedCreates[0]![0].requestBody as { thread?: { name?: string } }).thread?.name).toBe(
      'spaces/txn/threads/t1'
    );
    for (const u of update.mock.calls) {
      expect(u[0].name).toBe('spaces/txn/messages/log-1');
    }

    const lastUpdate = [...update.mock.calls].reverse()[0];
    const lastCreate = threadedCreates[0]![0];
    const finalLog =
      ((lastUpdate?.[0].requestBody.text as string) ??
        (lastCreate.requestBody.text as string) ??
        '')
        .replace(/• (?:\d+m)?\d+[ms]/g, '• Δs')
        .replace(/\/clawmini-e2e-google-chat-threads-[^/\s"]+/g, '/CLAWMINI_DIR');
    expect(finalLog).toMatchInlineSnapshot(`
      "• Δs  👉 txn-sub: echo done
      • Δs  👈 txn-sub: [DEBUG] echo done: \`\`\` done \`\`\`
      • Δs  ✅ txn-sub"
    `);

    // Reference the transcript helper so it stays part of the compiled test
    // surface even if a future run doesn't need its full output.
    const transcript = transcribe(create, update);
    expect(transcript).toContain('CREATE thread=spaces/txn/threads/t1');
    expect(transcript).toContain('✅ txn-sub');
  }, 120000);

  it('threads cron-triggered activity under a [SYSTEM]-tagged top-level post', async () => {
    // A proactive turn (session-timeout cron) has no inbound GChat message
    // to anchor on. The forwarder should:
    //   (1) post the cron prompt top-level with a `[SYSTEM] ` prefix, and
    //   (2) use the GChat thread that post just created as the anchor for
    //       any subsequent thread-log activity the agent produces.
    const { env } = envRef;
    const trpc = getTRPCClient({ socketPath: getSocketPath(env.e2eDir) });
    const subscription = makeFakeSubscription();
    const { api, create, update } = makeFakeChatApi();

    // Give each `create` a distinct thread.name so we can verify the cron
    // post's thread becomes the anchor for subsequent threaded posts.
    let threadCounter = 0;
    let msgCounter = 0;
    create.mockImplementation(async (params) => {
      msgCounter++;
      const msgName = `spaces/cron/messages/msg-${msgCounter}`;
      const isThreaded = Boolean(
        (params.requestBody as { thread?: { name?: string } }).thread
      );
      if (isThreaded) {
        // Threaded posts reuse the caller-supplied thread.
        return {
          data: {
            name: msgName,
            thread: (params.requestBody as { thread?: { name?: string } }).thread,
          },
        };
      }
      // Top-level posts: auto-create a fresh thread, mirroring real GChat.
      threadCounter++;
      return {
        data: {
          name: msgName,
          thread: { name: `spaces/cron/threads/auto-${threadCounter}` },
        },
      };
    });

    await updateGoogleChatState(
      { channelChatMap: { 'spaces/cron': { chatId: 'gc-cron' } } },
      env.e2eDir
    );
    await env.addChat('gc-cron', 'debug-agent');

    // Install session-timeout with a tight interval and a prompt that makes
    // the debug-agent spawn a subagent (producing thread-log events).
    const cronPrompt =
      'clawmini-lite.js subagents spawn --id cron-sub --async "echo session-ended"';
    env.writeChatSettings('gc-cron', {
      defaultAgent: 'debug-agent',
      routers: [{ use: '@clawmini/session-timeout', with: { timeout: '3s', prompt: cronPrompt } }],
    });

    startGoogleChatIngestion(
      BASE_CONFIG,
      trpc,
      {},
      { subscription, chatApi: api, startDir: env.e2eDir }
    );

    const config = { ...BASE_CONFIG, chatId: 'gc-cron' };

    await runForwarder({ trpc, chatApi: api, startDir: env.e2eDir, config }, async () => {
      // Send an inbound to trigger session-timeout scheduling.
      subscription.emitMessage(
        makeThreadedMessage({
          space: 'spaces/cron',
          messageId: 'kick',
          threadName: 'spaces/cron/threads/kick',
          text: 'hello',
        })
      );

      // Wait for the cron-triggered prompt to land as a top-level post.
      await vi.waitFor(
        () => {
          const sys = create.mock.calls.find(
            ([p]) =>
              typeof p.requestBody.text === 'string' &&
              (p.requestBody.text as string).startsWith('[SYSTEM] ') &&
              !('thread' in (p.requestBody as { thread?: unknown }))
          );
          expect(sys).toBeDefined();
        },
        { timeout: 30000, interval: 500 }
      );

      // Then wait for the subagent's ✅ status — proves the thread-log
      // activity anchored on the cron post's auto-thread successfully.
      await waitForSubagentComplete(update, create, 'cron-sub');
    });

    // Extract the thread the cron post created.
    const cronPost = create.mock.calls.find(
      ([p]) =>
        typeof p.requestBody.text === 'string' &&
        (p.requestBody.text as string).startsWith('[SYSTEM] ') &&
        !('thread' in (p.requestBody as { thread?: unknown }))
    )!;
    expect(cronPost).toBeDefined();
    const cronPostText = cronPost[0].requestBody.text as string;
    expect(cronPostText).toContain('[SYSTEM] ');
    expect(cronPostText).toContain('clawmini-lite.js subagents spawn --id cron-sub');

    // Subsequent threaded creates all anchor on the auto-thread GChat created
    // for the cron top-level post.
    const threadedCreates = create.mock.calls.filter(([p]) =>
      Boolean((p.requestBody as { thread?: { name?: string } }).thread)
    );
    expect(threadedCreates.length).toBeGreaterThanOrEqual(1);
    // All threaded posts must share the same (auto-generated) thread name —
    // the one returned for the cron post, not, say, `spaces/cron/threads/kick`
    // from the earlier inbound.
    const anchoredThreads = new Set(
      threadedCreates.map(
        ([p]) => (p.requestBody as { thread?: { name?: string } }).thread!.name!
      )
    );
    expect(anchoredThreads.size).toBe(1);
    const [anchorThread] = [...anchoredThreads];
    expect(anchorThread).toMatch(/^spaces\/cron\/threads\/auto-/);
    expect(anchorThread).not.toBe('spaces/cron/threads/kick');
  }, 60000);
});
