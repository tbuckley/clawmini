import { describe, it, expect, vi } from 'vitest';
import {
  getTRPCClient,
  startGoogleChatIngestion,
} from '../../src/adapter-google-chat/client.js';
import { getSocketPath } from '../../src/shared/workspace.js';
import {
  BASE_CONFIG,
  makeFakeChatApi,
  makeFakeSubscription,
  makePubsubMessage,
  readState,
  useGoogleChatAdapterEnv,
  writeState,
} from './_google-chat-fixtures.js';

describe('Google Chat Adapter E2E — inbound (Pub/Sub → daemon)', () => {
  const envRef = useGoogleChatAdapterEnv('e2e-google-chat-inbound');

  it('forwards authorized MESSAGE events to the daemon and stores a user-role message', async () => {
    const { env } = envRef;
    const trpc = getTRPCClient({ socketPath: getSocketPath(env.e2eDir) });
    const subscription = makeFakeSubscription();
    const { api } = makeFakeChatApi();

    await env.addChat('gc-chat');
    const chat = await env.connect('gc-chat');

    startGoogleChatIngestion(
      BASE_CONFIG,
      trpc,
      {},
      { subscription, chatApi: api, startDir: env.e2eDir }
    );

    subscription.emitMessage(
      makePubsubMessage({
        type: 'MESSAGE',
        space: { name: 'spaces/abc', type: 'DIRECT_MESSAGE', singleUserBotDm: true },
        message: {
          name: 'spaces/abc/messages/m1',
          sender: { email: 'user@example.com', type: 'USER' },
          text: 'hello from pubsub',
        },
      })
    );

    const msg = await chat.waitForMessage(
      (m) => m.role === 'user' && m.content === 'hello from pubsub'
    );
    expect(msg.role).toBe('user');
  });

  it('drops messages from unauthorized senders', async () => {
    const { env } = envRef;
    const trpc = getTRPCClient({ socketPath: getSocketPath(env.e2eDir) });
    const subscription = makeFakeSubscription();
    const { api } = makeFakeChatApi();

    await env.addChat('gc-chat');
    const chat = await env.connect('gc-chat');

    startGoogleChatIngestion(
      BASE_CONFIG,
      trpc,
      {},
      { subscription, chatApi: api, startDir: env.e2eDir }
    );

    const unauthorized = makePubsubMessage({
      type: 'MESSAGE',
      space: { name: 'spaces/abc', type: 'DIRECT_MESSAGE', singleUserBotDm: true },
      message: {
        name: 'spaces/abc/messages/m-unauth',
        sender: { email: 'stranger@example.com', type: 'USER' },
        text: 'I should be dropped',
      },
    });
    subscription.emitMessage(unauthorized);

    // Also send an authorized message so we have something to wait on.
    subscription.emitMessage(
      makePubsubMessage({
        type: 'MESSAGE',
        space: { name: 'spaces/abc', type: 'DIRECT_MESSAGE', singleUserBotDm: true },
        message: {
          name: 'spaces/abc/messages/m-ok',
          sender: { email: 'user@example.com', type: 'USER' },
          text: 'I should get through',
        },
      })
    );

    await chat.waitForMessage((m) => m.content === 'I should get through');
    const dropped = chat.messageBuffer.find((m) => m.content === 'I should be dropped');
    expect(dropped).toBeUndefined();
    // Unauthorized message is still acked so Pub/Sub doesn't redeliver it.
    await vi.waitFor(() => expect(unauthorized.ack).toHaveBeenCalled());
  });

  it('handles /chat routing commands, updating state and replying via chat API', async () => {
    const { env } = envRef;
    const trpc = getTRPCClient({ socketPath: getSocketPath(env.e2eDir) });
    const subscription = makeFakeSubscription();
    const { api, create } = makeFakeChatApi();

    // Seed the state with an existing mapping so the routing path is exercised rather
    // than the "first-ever message" auto-map branch.
    writeState(env.e2eDir, {
      channelChatMap: { 'spaces/existing': { chatId: 'gc-chat' } },
    });
    await env.addChat('gc-chat');
    await env.addChat('other-chat');

    startGoogleChatIngestion(
      BASE_CONFIG,
      trpc,
      {},
      { subscription, chatApi: api, startDir: env.e2eDir }
    );

    subscription.emitMessage(
      makePubsubMessage({
        type: 'MESSAGE',
        space: { name: 'spaces/route', type: 'SPACE' },
        user: { email: 'user@example.com' },
        message: {
          name: 'spaces/route/messages/cmd',
          text: '/chat other-chat',
        },
      })
    );

    await vi.waitFor(() => expect(create).toHaveBeenCalled(), { timeout: 5000 });

    expect(create.mock.calls[0]![0]).toMatchObject({
      parent: 'spaces/route',
    });

    await vi.waitFor(() => {
      const state = readState(env.e2eDir);
      expect(state.channelChatMap?.['spaces/route']?.chatId).toBe('other-chat');
    });
  });

  it('sends a first-contact warning when a new space messages with a mention', async () => {
    const { env } = envRef;
    const trpc = getTRPCClient({ socketPath: getSocketPath(env.e2eDir) });
    const subscription = makeFakeSubscription();
    const { api, create } = makeFakeChatApi();

    writeState(env.e2eDir, {
      channelChatMap: { 'spaces/known': { chatId: 'gc-chat' } },
    });
    await env.addChat('gc-chat');

    startGoogleChatIngestion(
      BASE_CONFIG,
      trpc,
      {},
      { subscription, chatApi: api, startDir: env.e2eDir }
    );

    subscription.emitMessage(
      makePubsubMessage({
        type: 'MESSAGE',
        space: { name: 'spaces/unmapped', type: 'SPACE' },
        user: { email: 'user@example.com' },
        message: {
          name: 'spaces/unmapped/messages/first',
          text: '@bot hello',
          annotations: [{ type: 'USER_MENTION' }],
        },
      })
    );

    await vi.waitFor(() => expect(create).toHaveBeenCalled(), { timeout: 5000 });

    const call = create.mock.calls[0]![0] as {
      parent: string;
      requestBody: { text: string };
    };
    expect(call.parent).toBe('spaces/unmapped');
    expect(call.requestBody.text).toContain('not currently mapped');
  });

  it('parses workspace-events payloads (ce-type attribute) into a forwarded message', async () => {
    const { env } = envRef;
    const trpc = getTRPCClient({ socketPath: getSocketPath(env.e2eDir) });
    const subscription = makeFakeSubscription();
    const { api } = makeFakeChatApi();

    writeState(env.e2eDir, {
      channelChatMap: { 'spaces/wsp': { chatId: 'gc-chat' } },
    });
    await env.addChat('gc-chat');
    const chat = await env.connect('gc-chat');

    startGoogleChatIngestion(
      BASE_CONFIG,
      trpc,
      {},
      { subscription, chatApi: api, startDir: env.e2eDir }
    );

    // Workspace-events envelope: no `type` field; payload is the message object itself,
    // and the `ce-type` Pub/Sub attribute tells us to treat it as a MESSAGE.
    subscription.emitMessage(
      makePubsubMessage(
        {
          name: 'spaces/wsp/messages/ws1',
          sender: { email: 'user@example.com', type: 'USER' },
          space: { name: 'spaces/wsp', type: 'DIRECT_MESSAGE', singleUserBotDm: true },
          text: 'workspace events payload',
        },
        { 'ce-type': 'google.workspace.chat.message.v1.created' }
      )
    );

    const msg = await chat.waitForMessage(
      (m) => m.role === 'user' && m.content === 'workspace events payload'
    );
    expect(msg.role).toBe('user');
  });

  it('auto-maps the first-ever message to config.chatId and forwards it', async () => {
    const { env } = envRef;
    const trpc = getTRPCClient({ socketPath: getSocketPath(env.e2eDir) });
    const subscription = makeFakeSubscription();
    const { api } = makeFakeChatApi();

    // Empty state — no channelChatMap entries at all, so any incoming message
    // should trigger the "first-ever message" auto-map branch.
    writeState(env.e2eDir, {});
    await env.addChat('gc-chat');
    const chat = await env.connect('gc-chat');

    startGoogleChatIngestion(
      BASE_CONFIG,
      trpc,
      {},
      { subscription, chatApi: api, startDir: env.e2eDir }
    );

    subscription.emitMessage(
      makePubsubMessage({
        type: 'MESSAGE',
        space: { name: 'spaces/first', type: 'SPACE' },
        user: { email: 'user@example.com' },
        message: {
          name: 'spaces/first/messages/first1',
          sender: { email: 'user@example.com', type: 'USER' },
          text: 'first contact body',
        },
      })
    );

    const msg = await chat.waitForMessage(
      (m) => m.role === 'user' && m.content === 'first contact body'
    );
    expect(msg.role).toBe('user');

    // The space should now be mapped to the default chat id from config.
    await vi.waitFor(() => {
      const state = readState(env.e2eDir);
      expect(state.channelChatMap?.['spaces/first']?.chatId).toBe('gc-chat');
    });
  });

  it('drops non-mention messages in a non-DM space when requireMention is true', async () => {
    const { env } = envRef;
    const trpc = getTRPCClient({ socketPath: getSocketPath(env.e2eDir) });
    const subscription = makeFakeSubscription();
    const { api } = makeFakeChatApi();

    writeState(env.e2eDir, {
      channelChatMap: { 'spaces/rm': { chatId: 'gc-chat' } },
    });
    await env.addChat('gc-chat');
    const chat = await env.connect('gc-chat');

    startGoogleChatIngestion(
      { ...BASE_CONFIG, requireMention: true },
      trpc,
      {},
      { subscription, chatApi: api, startDir: env.e2eDir }
    );

    // Non-mention message in a mapped SPACE (not a DM) — should be ack'd and dropped.
    const unmentioned = makePubsubMessage({
      type: 'MESSAGE',
      space: { name: 'spaces/rm', type: 'SPACE' },
      user: { email: 'user@example.com' },
      message: {
        name: 'spaces/rm/messages/nomention',
        sender: { email: 'user@example.com', type: 'USER' },
        text: 'plain channel chatter',
      },
    });
    subscription.emitMessage(unmentioned);

    // A mention of the bot — should flow through to the daemon.
    subscription.emitMessage(
      makePubsubMessage({
        type: 'MESSAGE',
        space: { name: 'spaces/rm', type: 'SPACE' },
        user: { email: 'user@example.com' },
        message: {
          name: 'spaces/rm/messages/withmention',
          sender: { email: 'user@example.com', type: 'USER' },
          text: '@bot help me',
          annotations: [{ type: 'USER_MENTION', userMention: { user: { type: 'BOT' } } }],
        },
      })
    );

    await chat.waitForMessage((m) => m.content === '@bot help me');
    const dropped = chat.messageBuffer.find((m) => m.content === 'plain channel chatter');
    expect(dropped).toBeUndefined();
    await vi.waitFor(() => expect(unmentioned.ack).toHaveBeenCalled());
  });

  it('issues a workspace-events subscription on ADDED_TO_SPACE', async () => {
    const { env } = envRef;
    const trpc = getTRPCClient({ socketPath: getSocketPath(env.e2eDir) });
    const subscription = makeFakeSubscription();
    const { api } = makeFakeChatApi();

    const fetchMock = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({ name: 'subscriptions/abc', expireTime: '2026-01-01T00:00:00Z' }),
        { status: 200 }
      )
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;

    try {
      startGoogleChatIngestion(
        { ...BASE_CONFIG, oauthClientId: 'id', oauthClientSecret: 'secret' },
        trpc,
        {},
        { subscription, chatApi: api, startDir: env.e2eDir }
      );

      // Force the user-auth client cache to look already-authed by pre-seeding oauthTokens
      // in state so getUserAuthClient doesn't attempt the interactive OAuth flow.
      writeState(env.e2eDir, {
        oauthTokens: {
          access_token: 'fake',
          refresh_token: 'fake',
          expiry_date: Date.now() + 1_000_000,
        },
      });

      subscription.emitMessage(
        makePubsubMessage({
          type: 'ADDED_TO_SPACE',
          space: { name: 'spaces/added', type: 'SPACE' },
          user: { email: 'user@example.com' },
        })
      );

      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled(), { timeout: 5000 });

      const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
      expect(url).toBe('https://workspaceevents.googleapis.com/v1/subscriptions');
      expect(init.method).toBe('POST');

      await vi.waitFor(() => {
        const state = readState(env.e2eDir);
        expect(state.channelChatMap?.['spaces/added']?.subscriptionId).toBe('subscriptions/abc');
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
