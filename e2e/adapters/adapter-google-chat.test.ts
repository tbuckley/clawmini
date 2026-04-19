import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { TestEnvironment } from '../_helpers/test-environment.js';
import {
  getTRPCClient,
  startGoogleChatIngestion,
  type GoogleChatApi,
  type MessageSourceLike,
} from '../../src/adapter-google-chat/client.js';
import { startDaemonToGoogleChatForwarder } from '../../src/adapter-google-chat/forwarder.js';
import { getSocketPath } from '../../src/shared/workspace.js';
import type { GoogleChatConfig } from '../../src/adapter-google-chat/config.js';
import {
  updateGoogleChatState,
  type GoogleChatState,
} from '../../src/adapter-google-chat/state.js';

const BASE_CONFIG: GoogleChatConfig = {
  projectId: 'fake-project',
  subscriptionName: 'fake-sub',
  topicName: 'fake-topic',
  authorizedUsers: ['user@example.com'],
  requireMention: false,
  chatId: 'gc-chat',
  driveUploadEnabled: false,
};

/**
 * Wrap a trpc client so we can observe when `waitForMessages.subscribe` has been
 * acknowledged by the server (SSE `started` frame). Tests `await ready()` before
 * sending a message so the forwarder's subscription is guaranteed to be live.
 */
function instrumentTrpcForReadiness(trpc: ReturnType<typeof getTRPCClient>) {
  let resolveReady: () => void = () => {};
  const ready = new Promise<void>((r) => {
    resolveReady = r;
  });
  const wrapped = new Proxy(trpc, {
    get(target, prop, receiver) {
      if (prop === 'waitForMessages') {
        const route = Reflect.get(target, prop, receiver) as {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          subscribe: (input: unknown, opts: any) => { unsubscribe: () => void };
        };
        return {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          subscribe: (input: unknown, opts: any) =>
            route.subscribe(input, {
              ...opts,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              onStarted: (ctx: any) => {
                resolveReady();
                opts?.onStarted?.(ctx);
              },
            }),
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as ReturnType<typeof getTRPCClient>;
  return { trpc: wrapped, ready };
}

interface FakeMessage {
  data: Buffer;
  attributes: Record<string, string>;
  ack: ReturnType<typeof vi.fn>;
  nack: ReturnType<typeof vi.fn>;
}

function makePubsubMessage(
  body: Record<string, unknown>,
  attributes: Record<string, string> = {}
): FakeMessage {
  return {
    data: Buffer.from(JSON.stringify(body)),
    attributes,
    ack: vi.fn(),
    nack: vi.fn(),
  };
}

function makeFakeChatApi() {
  const create = vi.fn().mockResolvedValue({});
  const update = vi.fn().mockResolvedValue({});
  const list = vi.fn().mockResolvedValue({ data: { messages: [] } });
  const api = {
    spaces: {
      messages: { create, update, list },
    },
  } as unknown as GoogleChatApi;
  return { api, create, update, list };
}

function makeFakeSubscription(): MessageSourceLike & {
  emitMessage: (msg: FakeMessage) => void;
} {
  const emitter = new EventEmitter();
  const messageSource = emitter as unknown as MessageSourceLike;
  return Object.assign(messageSource, {
    emitMessage: (msg: FakeMessage) => emitter.emit('message', msg),
  });
}

function readState(e2eDir: string): GoogleChatState {
  const p = path.join(e2eDir, '.clawmini', 'adapters', 'google-chat', 'state.json');
  if (!fs.existsSync(p)) return {};
  return JSON.parse(fs.readFileSync(p, 'utf-8')) as GoogleChatState;
}

function writeState(e2eDir: string, state: GoogleChatState) {
  const dir = path.join(e2eDir, '.clawmini', 'adapters', 'google-chat');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(state, null, 2));
}

describe('Google Chat Adapter E2E', () => {
  let env: TestEnvironment;

  beforeAll(async () => {
    env = new TestEnvironment('e2e-google-chat');
    await env.setup();
    await env.init();
    await env.up();
  }, 30000);

  afterAll(async () => {
    await env.teardown();
  }, 30000);

  afterEach(async () => {
    await env.disconnectAll();
    // The forwarder's saveLastMessageId writes through the module-level
    // updateGoogleChatState queue and can still be inflight here (abort resolves
    // the forwarder promise without waiting on its messageQueue). Push a no-op
    // onto that queue and await it so any pending merge-writes are flushed
    // *before* we atomically overwrite the file — otherwise a late write can
    // resurrect channelChatMap entries from the previous test.
    await updateGoogleChatState({}, env.e2eDir);
    writeState(env.e2eDir, {});
  });

  describe('inbound (Pub/Sub → daemon)', () => {
    it('forwards authorized MESSAGE events to the daemon and stores a user-role message', async () => {
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
            annotations: [
              { type: 'USER_MENTION', userMention: { user: { type: 'BOT' } } },
            ],
          },
        })
      );

      await chat.waitForMessage((m) => m.content === '@bot help me');
      const dropped = chat.messageBuffer.find((m) => m.content === 'plain channel chatter');
      expect(dropped).toBeUndefined();
      await vi.waitFor(() => expect(unmentioned.ack).toHaveBeenCalled());
    });

    it('issues a workspace-events subscription on ADDED_TO_SPACE', async () => {
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

  describe('outbound (daemon → chat API via forwarder)', () => {
    let abortController: AbortController;

    beforeEach(() => {
      abortController = new AbortController();
    });

    afterEach(() => {
      abortController.abort();
    });

    it('forwards agent-visible messages from the daemon to the chat API', async () => {
      const rawTrpc = getTRPCClient({ socketPath: getSocketPath(env.e2eDir) });
      const { trpc, ready } = instrumentTrpcForReadiness(rawTrpc);
      const { api, create } = makeFakeChatApi();

      // Map a fake space to our chat so the forwarder knows where to post.
      writeState(env.e2eDir, {
        channelChatMap: { 'spaces/outbound': { chatId: 'gc-chat' } },
      });
      await env.addChat('gc-chat');

      // user-role messages are filtered out by default; allow them through so we don't need
      // a real agent to produce the side of the conversation.
      const forwarderPromise = startDaemonToGoogleChatForwarder(
        trpc,
        BASE_CONFIG,
        { filters: { user: true } },
        abortController.signal,
        { chatApi: api, startDir: env.e2eDir }
      );

      await ready;
      await env.sendMessage('outbound payload', { chat: 'gc-chat', noWait: true });

      await vi.waitFor(
        () => {
          expect(create).toHaveBeenCalled();
          const call = create.mock.calls.find(
            (c) =>
              (c[0] as { parent: string; requestBody: { text: string } }).requestBody.text ===
              'outbound payload'
          );
          expect(call).toBeDefined();
        },
        { timeout: 10000 }
      );

      const match = create.mock.calls.find(
        (c) =>
          (c[0] as { parent: string; requestBody: { text: string } }).requestBody.text ===
          'outbound payload'
      )!;
      expect((match[0] as { parent: string }).parent).toBe('spaces/outbound');

      abortController.abort();
      await forwarderPromise;
    }, 30000);

    it('drops messages when no mapped space exists for the chat', async () => {
      const rawTrpc = getTRPCClient({ socketPath: getSocketPath(env.e2eDir) });
      const { trpc, ready } = instrumentTrpcForReadiness(rawTrpc);
      const { api, create } = makeFakeChatApi();

      // No channelChatMap entry → forwarder should advance lastSyncedMessageIds but not post.
      writeState(env.e2eDir, {});
      await env.addChat('gc-chat');

      const forwarderPromise = startDaemonToGoogleChatForwarder(
        trpc,
        BASE_CONFIG,
        { filters: { user: true } },
        abortController.signal,
        { chatApi: api, startDir: env.e2eDir }
      );

      await ready;
      // Capture the forwarder's baseline cursor (it seeds to the chat's current latest
      // message id on start), then send and wait for that cursor to advance — which
      // proves the drop path executed without relying on a wall-clock delay.
      const baseline = readState(env.e2eDir).lastSyncedMessageIds?.['gc-chat'];
      await env.sendMessage('unmapped payload', { chat: 'gc-chat', noWait: true });

      await vi.waitFor(
        () => {
          const cur = readState(env.e2eDir).lastSyncedMessageIds?.['gc-chat'];
          expect(cur).toBeDefined();
          expect(cur).not.toBe(baseline);
        },
        { timeout: 10000 }
      );

      const match = create.mock.calls.find(
        (c) =>
          (c[0] as { requestBody: { text: string } }).requestBody.text === 'unmapped payload'
      );
      expect(match).toBeUndefined();

      abortController.abort();
      await forwarderPromise;
    }, 30000);
  });

  describe('round-trip (Pub/Sub → daemon → forwarder → chat API)', () => {
    it('sends an inbound message through the daemon and back out to the chat API', async () => {
      const rawTrpc = getTRPCClient({ socketPath: getSocketPath(env.e2eDir) });
      const { trpc, ready } = instrumentTrpcForReadiness(rawTrpc);
      const subscription = makeFakeSubscription();
      const { api, create } = makeFakeChatApi();

      writeState(env.e2eDir, {
        channelChatMap: { 'spaces/roundtrip': { chatId: 'gc-chat' } },
      });
      await env.addChat('gc-chat');

      startGoogleChatIngestion(
        BASE_CONFIG,
        trpc,
        {},
        { subscription, chatApi: api, startDir: env.e2eDir }
      );

      const abort = new AbortController();
      const forwarderPromise = startDaemonToGoogleChatForwarder(
        trpc,
        BASE_CONFIG,
        { filters: { user: true } },
        abort.signal,
        { chatApi: api, startDir: env.e2eDir }
      );

      await ready;

      subscription.emitMessage(
        makePubsubMessage({
          type: 'MESSAGE',
          space: { name: 'spaces/roundtrip', type: 'DIRECT_MESSAGE', singleUserBotDm: true },
          message: {
            name: 'spaces/roundtrip/messages/rt1',
            sender: { email: 'user@example.com', type: 'USER' },
            text: 'round trip',
          },
        })
      );

      await vi.waitFor(
        () => {
          const match = create.mock.calls.find(
            (c) =>
              (c[0] as { parent: string; requestBody: { text: string } }).requestBody.text ===
              'round trip'
          );
          expect(match).toBeDefined();
        },
        { timeout: 10000 }
      );

      abort.abort();
      await forwarderPromise;
    }, 30000);
  });
});

