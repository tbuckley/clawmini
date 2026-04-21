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
 * The default agent echoes `CLAW_CLI_MESSAGE` into a CommandLogMessage (which
 * routes to `thread-log`) and an AgentReplyMessage (which routes to
 * `top-level`), giving each turn one thread-log entry and one top-level post.
 */
describe('Google Chat Adapter E2E — threaded activity log', () => {
  const envRef = useGoogleChatAdapterEnv('e2e-google-chat-threads');

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
    await env.addChat('gc-threads');

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
          text: 'hello threads',
        })
      );

      await vi.waitFor(
        () => {
          const reply = create.mock.calls.find(
            ([p]) => p.requestBody.text === 'hello threads' && !('thread' in p.requestBody)
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
  }, 45000);

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
    // and returns an automatic reply with no agent work.
    env.writeChatSettings('gc-newcmd', { routers: ['@clawmini/slash-new'] });

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
          text: 'do work',
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
        { timeout: 15000 }
      );

      // Crucially: nothing should anchor to the /new thread.
      const anchoredOnSlash = create.mock.calls.find(
        ([p]) =>
          (p.requestBody as { thread?: { name?: string } }).thread?.name ===
          'spaces/newcmd/threads/slash-thread'
      );
      expect(anchoredOnSlash).toBeUndefined();
    });
  }, 45000);

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
    await env.addChat('gc-dm');

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
        text: 'dm mode',
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
              ([p]) => p.requestBody.text === 'dm mode' && !('thread' in p.requestBody)
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
  }, 45000);

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
});
