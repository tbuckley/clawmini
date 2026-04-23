import { describe, it, expect, vi } from 'vitest';
import {
  getTRPCClient,
  startGoogleChatIngestion,
} from '../../src/adapter-google-chat/client.js';
import {
  readGoogleChatState,
  updateGoogleChatState,
} from '../../src/adapter-google-chat/state.js';
import { getSocketPath } from '../../src/shared/workspace.js';
import {
  BASE_CONFIG,
  makeDmMessage,
  makeFakeChatApi,
  makeFakeSubscription,
  makePubsubMessage,
  makeSpaceMessage,
  useGoogleChatAdapterEnv,
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
      makeDmMessage({ space: 'spaces/abc', messageId: 'm1', text: 'hello from pubsub' })
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

    const unauthorized = makeDmMessage({
      space: 'spaces/abc',
      messageId: 'm-unauth',
      sender: 'stranger@example.com',
      text: 'I should be dropped',
    });
    subscription.emitMessage(unauthorized);

    // Also send an authorized message so we have something to wait on.
    subscription.emitMessage(
      makeDmMessage({ space: 'spaces/abc', messageId: 'm-ok', text: 'I should get through' })
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
    await updateGoogleChatState(
      { channelChatMap: { 'spaces/existing': { chatId: 'gc-chat' } } },
      env.e2eDir
    );
    await env.addChat('gc-chat');
    await env.addChat('other-chat');

    startGoogleChatIngestion(
      BASE_CONFIG,
      trpc,
      {},
      { subscription, chatApi: api, startDir: env.e2eDir }
    );

    subscription.emitMessage(
      makeSpaceMessage({ space: 'spaces/route', messageId: 'cmd', text: '/chat other-chat' })
    );

    await vi.waitFor(() => expect(create).toHaveBeenCalled(), { timeout: 5000 });

    expect(create.mock.calls[0]![0]).toMatchObject({
      parent: 'spaces/route',
    });

    await vi.waitFor(async () => {
      const state = await readGoogleChatState(env.e2eDir);
      expect(state.channelChatMap?.['spaces/route']?.chatId).toBe('other-chat');
    });
  });

  it('sends a first-contact warning when a new space messages with a mention', async () => {
    const { env } = envRef;
    const trpc = getTRPCClient({ socketPath: getSocketPath(env.e2eDir) });
    const subscription = makeFakeSubscription();
    const { api, create } = makeFakeChatApi();

    await updateGoogleChatState(
      { channelChatMap: { 'spaces/known': { chatId: 'gc-chat' } } },
      env.e2eDir
    );
    await env.addChat('gc-chat');

    startGoogleChatIngestion(
      BASE_CONFIG,
      trpc,
      {},
      { subscription, chatApi: api, startDir: env.e2eDir }
    );

    subscription.emitMessage(
      makeSpaceMessage({
        space: 'spaces/unmapped',
        messageId: 'first',
        text: '@bot hello',
        // First-contact path only checks for the presence of a USER_MENTION
        // annotation, so use the simple form rather than the bot-targeted one.
        annotations: [{ type: 'USER_MENTION' }],
      })
    );

    await vi.waitFor(() => expect(create).toHaveBeenCalled(), { timeout: 5000 });

    const call = create.mock.calls[0]![0];
    expect(call.parent).toBe('spaces/unmapped');
    expect(call.requestBody.text).toContain('not currently mapped');
  });

  it('parses workspace-events payloads (ce-type attribute) into a forwarded message', async () => {
    const { env } = envRef;
    const trpc = getTRPCClient({ socketPath: getSocketPath(env.e2eDir) });
    const subscription = makeFakeSubscription();
    const { api } = makeFakeChatApi();

    await updateGoogleChatState(
      { channelChatMap: { 'spaces/wsp': { chatId: 'gc-chat' } } },
      env.e2eDir
    );
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

    // No seeding — afterEach already reset state, so any incoming message
    // should trigger the "first-ever message" auto-map branch.
    await env.addChat('gc-chat');
    const chat = await env.connect('gc-chat');

    startGoogleChatIngestion(
      BASE_CONFIG,
      trpc,
      {},
      { subscription, chatApi: api, startDir: env.e2eDir }
    );

    subscription.emitMessage(
      makeSpaceMessage({
        space: 'spaces/first',
        messageId: 'first1',
        sender: 'user@example.com',
        text: 'first contact body',
      })
    );

    const msg = await chat.waitForMessage(
      (m) => m.role === 'user' && m.content === 'first contact body'
    );
    expect(msg.role).toBe('user');

    // The space should now be mapped to the default chat id from config.
    await vi.waitFor(async () => {
      const state = await readGoogleChatState(env.e2eDir);
      expect(state.channelChatMap?.['spaces/first']?.chatId).toBe('gc-chat');
    });
  });

  it('drops non-mention messages in a non-DM space when requireMention is true', async () => {
    const { env } = envRef;
    const trpc = getTRPCClient({ socketPath: getSocketPath(env.e2eDir) });
    const subscription = makeFakeSubscription();
    const { api } = makeFakeChatApi();

    await updateGoogleChatState(
      { channelChatMap: { 'spaces/rm': { chatId: 'gc-chat' } } },
      env.e2eDir
    );
    await env.addChat('gc-chat');
    const chat = await env.connect('gc-chat');

    startGoogleChatIngestion(
      { ...BASE_CONFIG, requireMention: true },
      trpc,
      {},
      { subscription, chatApi: api, startDir: env.e2eDir }
    );

    // Non-mention message in a mapped SPACE (not a DM) — should be ack'd and dropped.
    const unmentioned = makeSpaceMessage({
      space: 'spaces/rm',
      messageId: 'nomention',
      sender: 'user@example.com',
      text: 'plain channel chatter',
    });
    subscription.emitMessage(unmentioned);

    // A mention of the bot — should flow through to the daemon.
    subscription.emitMessage(
      makeSpaceMessage({
        space: 'spaces/rm',
        messageId: 'withmention',
        sender: 'user@example.com',
        text: '@bot help me',
        mention: true,
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
        JSON.stringify({
          name: 'operations/abc',
          done: true,
          response: { name: 'subscriptions/abc', expireTime: '2026-01-01T00:00:00Z' },
        }),
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
      await updateGoogleChatState(
        {
          oauthTokens: {
            access_token: 'fake',
            refresh_token: 'fake',
            expiry_date: Date.now() + 1_000_000,
          },
        },
        env.e2eDir
      );

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

      await vi.waitFor(async () => {
        const state = await readGoogleChatState(env.e2eDir);
        expect(state.channelChatMap?.['spaces/added']?.subscriptionId).toBe('subscriptions/abc');
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('tears down the workspace-events subscription on REMOVED_FROM_SPACE', async () => {
    const { env } = envRef;
    const trpc = getTRPCClient({ socketPath: getSocketPath(env.e2eDir) });
    const subscription = makeFakeSubscription();
    const { api } = makeFakeChatApi();

    await updateGoogleChatState(
      {
        channelChatMap: {
          'spaces/rm-done': {
            chatId: 'gc-chat',
            subscriptionId: 'subscriptions/rm-done',
            expirationDate: '2099-01-01T00:00:00Z',
          },
        },
        oauthTokens: {
          access_token: 'fake',
          refresh_token: 'fake',
          expiry_date: Date.now() + 1_000_000,
        },
      },
      env.e2eDir
    );
    await env.addChat('gc-chat');

    const fetchMock = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(null, { status: 200 }));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;

    try {
      startGoogleChatIngestion(
        { ...BASE_CONFIG, oauthClientId: 'id', oauthClientSecret: 'secret' },
        trpc,
        {},
        { subscription, chatApi: api, startDir: env.e2eDir }
      );

      subscription.emitMessage(
        makePubsubMessage({
          type: 'REMOVED_FROM_SPACE',
          space: { name: 'spaces/rm-done', type: 'SPACE' },
          user: { email: 'user@example.com' },
        })
      );

      await vi.waitFor(() => {
        const deleteCall = fetchMock.mock.calls.find(
          ([url, init]) =>
            typeof url === 'string' &&
            url.endsWith('/v1/subscriptions/rm-done') &&
            (init as RequestInit | undefined)?.method === 'DELETE'
        );
        expect(deleteCall).toBeDefined();
      }, { timeout: 5000 });

      // The subscription fields should be stripped, but chatId preserved
      // because entry.chatId was set.
      await vi.waitFor(async () => {
        const state = await readGoogleChatState(env.e2eDir);
        const entry = state.channelChatMap?.['spaces/rm-done'];
        expect(entry?.chatId).toBe('gc-chat');
        expect(entry?.subscriptionId).toBeUndefined();
        expect(entry?.expirationDate).toBeUndefined();
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('handles CARD_CLICKED by stripping buttons and forwarding /approve to the daemon', async () => {
    const { env } = envRef;
    const trpc = getTRPCClient({ socketPath: getSocketPath(env.e2eDir) });
    const subscription = makeFakeSubscription();
    const { api, update } = makeFakeChatApi();

    await updateGoogleChatState(
      { channelChatMap: { 'spaces/cc': { chatId: 'gc-chat' } } },
      env.e2eDir
    );
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
        type: 'CARD_CLICKED',
        space: { name: 'spaces/cc', type: 'DIRECT_MESSAGE', singleUserBotDm: true },
        user: { email: 'user@example.com' },
        message: {
          name: 'spaces/cc/messages/card-1',
          sender: { type: 'BOT' },
          cardsV2: [
            {
              cardId: 'c1',
              card: {
                header: { title: 'Policy', subtitle: 'Pending' },
                sections: [
                  {
                    widgets: [
                      { textParagraph: { text: 'please approve' } },
                      { buttonList: { buttons: [{ text: 'Approve' }, { text: 'Reject' }] } },
                    ],
                  },
                ],
              },
            },
          ],
        },
        action: {
          actionMethodName: 'approve',
          parameters: [{ key: 'policyId', value: 'pol-cc-1' }],
        },
      })
    );

    // Card update strips buttons and updates the subtitle to 'Policy Approved'.
    await vi.waitFor(() => expect(update).toHaveBeenCalled(), { timeout: 5000 });
    const updateCall = update.mock.calls[0]![0];
    expect(updateCall.name).toBe('spaces/cc/messages/card-1');
    expect(updateCall.updateMask).toBe('cardsV2');
    const updatedCard = updateCall.requestBody.cardsV2![0] as {
      card: {
        header: { subtitle: string };
        sections: { widgets: Array<Record<string, unknown>> }[];
      };
    };
    expect(updatedCard.card.header.subtitle).toBe('Policy Approved');
    for (const section of updatedCard.card.sections) {
      for (const widget of section.widgets) {
        expect(widget).not.toHaveProperty('buttonList');
      }
    }

    // The daemon should receive a user message with the slash command.
    await chat.waitForMessage(
      (m) => m.role === 'user' && m.content === '/approve pol-cc-1'
    );
  });

  it('handles /agent by creating a new chat and mapping the space to it', async () => {
    const { env } = envRef;
    const trpc = getTRPCClient({ socketPath: getSocketPath(env.e2eDir) });
    const subscription = makeFakeSubscription();
    const { api, create } = makeFakeChatApi();

    await updateGoogleChatState(
      { channelChatMap: { 'spaces/seed': { chatId: 'gc-chat' } } },
      env.e2eDir
    );
    await env.addChat('gc-chat');
    await env.addAgent('router-agent');

    startGoogleChatIngestion(
      BASE_CONFIG,
      trpc,
      {},
      { subscription, chatApi: api, startDir: env.e2eDir }
    );

    subscription.emitMessage(
      makeSpaceMessage({
        space: 'spaces/agent-route',
        messageId: 'cmd',
        text: '/agent router-agent',
      })
    );

    await vi.waitFor(() => expect(create).toHaveBeenCalled(), { timeout: 5000 });
    const reply = create.mock.calls[0]![0];
    expect(reply.parent).toBe('spaces/agent-route');
    expect(reply.requestBody.text).toMatch(/Successfully created new chat/);

    await vi.waitFor(async () => {
      const state = await readGoogleChatState(env.e2eDir);
      const newChatId = state.channelChatMap?.['spaces/agent-route']?.chatId;
      expect(newChatId).toMatch(/^router-agent-google-chat/);
    });
  });

  it('forwards quote-replies with an attribution line and the quoted message as a blockquote', async () => {
    const { env } = envRef;
    const trpc = getTRPCClient({ socketPath: getSocketPath(env.e2eDir) });
    const subscription = makeFakeSubscription();
    const { api } = makeFakeChatApi();

    await updateGoogleChatState(
      { channelChatMap: { 'spaces/quoted': { chatId: 'gc-chat' } } },
      env.e2eDir
    );
    await env.addChat('gc-chat');
    const chat = await env.connect('gc-chat');

    startGoogleChatIngestion(
      BASE_CONFIG,
      trpc,
      {},
      { subscription, chatApi: api, startDir: env.e2eDir }
    );

    subscription.emitMessage(
      makeDmMessage({
        space: 'spaces/quoted',
        messageId: 'reply-1',
        text: "Yes, I'm in!",
        quotedMessageMetadata: {
          name: 'spaces/quoted/messages/orig-1',
          quotedMessageSnapshot: {
            text: 'Would anyone like to get dinner Sunday?\nOr maybe lunch?',
            sender: { email: 'other@example.com', type: 'HUMAN' },
          },
        },
      })
    );

    const msg = await chat.waitForMessage(
      (m) => m.role === 'user' && m.content.includes("Yes, I'm in!")
    );
    expect(msg.content).toBe(
      "> **other@example.com said:**\n> Would anyone like to get dinner Sunday?\n> Or maybe lunch?\n\nYes, I'm in!"
    );
  });

  it('labels quoted bot messages as "Assistant" and leaves out attribution for authorized users', async () => {
    const { env } = envRef;
    const trpc = getTRPCClient({ socketPath: getSocketPath(env.e2eDir) });
    const subscription = makeFakeSubscription();
    const { api } = makeFakeChatApi();

    await updateGoogleChatState(
      { channelChatMap: { 'spaces/quoted2': { chatId: 'gc-chat' } } },
      env.e2eDir
    );
    await env.addChat('gc-chat');
    const chat = await env.connect('gc-chat');

    startGoogleChatIngestion(
      BASE_CONFIG,
      trpc,
      {},
      { subscription, chatApi: api, startDir: env.e2eDir }
    );

    subscription.emitMessage(
      makeDmMessage({
        space: 'spaces/quoted2',
        messageId: 'reply-bot',
        text: 'thanks',
        quotedMessageMetadata: {
          name: 'spaces/quoted2/messages/bot-1',
          quotedMessageSnapshot: { text: 'Done.', sender: { type: 'BOT' } },
        },
      })
    );
    const botReply = await chat.waitForMessage(
      (m) => m.role === 'user' && m.content.includes('thanks')
    );
    expect(botReply.content).toBe('> **Assistant said:**\n> Done.\n\nthanks');

    subscription.emitMessage(
      makeDmMessage({
        space: 'spaces/quoted2',
        messageId: 'reply-self',
        text: 'still relevant',
        quotedMessageMetadata: {
          name: 'spaces/quoted2/messages/self-1',
          quotedMessageSnapshot: {
            text: 'earlier note',
            sender: { email: 'user@example.com', type: 'HUMAN' },
          },
        },
      })
    );
    const selfReply = await chat.waitForMessage(
      (m) => m.role === 'user' && m.content.includes('still relevant')
    );
    expect(selfReply.content).toBe('> earlier note\n\nstill relevant');

    subscription.emitMessage(
      makeDmMessage({
        space: 'spaces/quoted2',
        messageId: 'reply-fallback',
        text: 'wow',
        quotedMessageMetadata: {
          name: 'spaces/quoted2/messages/fallback-1',
          quotedMessageSnapshot: {
            text: 'no email here',
            sender: { displayName: 'John Doe', name: 'users/1234', type: 'HUMAN' },
          },
        },
      })
    );
    const fallbackReply = await chat.waitForMessage(
      (m) => m.role === 'user' && m.content.includes('wow')
    );
    expect(fallbackReply.content).toBe('> **John Doe said:**\n> no email here\n\nwow');
  });

  it('downloads attachments and forwards them with the message to the daemon', async () => {
    const { env } = envRef;
    const trpc = getTRPCClient({ socketPath: getSocketPath(env.e2eDir) });
    const subscription = makeFakeSubscription();
    const { api } = makeFakeChatApi();

    await updateGoogleChatState(
      { channelChatMap: { 'spaces/att': { chatId: 'gc-chat' } } },
      env.e2eDir
    );
    await env.addChat('gc-chat');
    const chat = await env.connect('gc-chat');

    const fakePayload = Buffer.from('hello attachment payload');
    const downloadAttachment = vi.fn(async () => fakePayload);

    startGoogleChatIngestion(
      BASE_CONFIG,
      trpc,
      {},
      { subscription, chatApi: api, startDir: env.e2eDir, downloadAttachment }
    );

    subscription.emitMessage(
      makeDmMessage({
        space: 'spaces/att',
        messageId: 'att1',
        text: 'with attachment',
        attachment: [
          { contentName: 'note.txt', attachmentDataRef: { resourceName: 'media/note' } },
        ],
      })
    );

    const msg = await chat.waitForMessage(
      (m) =>
        m.role === 'user' &&
        m.content.startsWith('with attachment') &&
        m.content.includes('note.txt')
    );
    expect(downloadAttachment).toHaveBeenCalledWith('media/note', undefined);

    // The daemon relocates uploaded files into the agent's files dir and
    // suffixes the message content with an "Attached files:" block referencing
    // the relative path.
    expect(msg.content).toMatch(/Attached files:/);
  });
});
