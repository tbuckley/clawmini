import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { TestEnvironment } from '../_helpers/test-environment.js';
import {
  getTRPCClient,
  type GoogleChatApi,
  type MessageSourceLike,
} from '../../src/adapter-google-chat/client.js';
import type { GoogleChatConfig } from '../../src/adapter-google-chat/config.js';
import { startDaemonToGoogleChatForwarder } from '../../src/adapter-google-chat/forwarder.js';
import { updateGoogleChatState } from '../../src/adapter-google-chat/state.js';

export const BASE_CONFIG: GoogleChatConfig = {
  projectId: 'fake-project',
  subscriptionName: 'fake-sub',
  topicName: 'fake-topic',
  authorizedUsers: ['user@example.com'],
  requireMention: false,
  chatId: 'gc-chat',
  driveUploadEnabled: false,
};

export interface FakeMessage {
  data: Buffer;
  attributes: Record<string, string>;
  ack: ReturnType<typeof vi.fn>;
  nack: ReturnType<typeof vi.fn>;
}

export function makePubsubMessage(
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

/**
 * Pub/Sub-shaped MESSAGE event in a DIRECT_MESSAGE (singleUserBotDm) space.
 * `sender` defaults to the authorized user. Pass `attachment` for attachment
 * tests, or `quotedMessageMetadata` to model a quote-reply.
 */
export function makeDmMessage(opts: {
  space: string;
  messageId: string;
  text: string;
  sender?: string;
  attachment?: unknown[];
  quotedMessageMetadata?: unknown;
}): FakeMessage {
  const sender = opts.sender ?? 'user@example.com';
  return makePubsubMessage({
    type: 'MESSAGE',
    space: { name: opts.space, type: 'DIRECT_MESSAGE', singleUserBotDm: true },
    message: {
      name: `${opts.space}/messages/${opts.messageId}`,
      sender: { email: sender, type: 'USER' },
      text: opts.text,
      ...(opts.attachment ? { attachment: opts.attachment } : {}),
      ...(opts.quotedMessageMetadata
        ? { quotedMessageMetadata: opts.quotedMessageMetadata }
        : {}),
    },
  });
}

/**
 * Pub/Sub-shaped MESSAGE event in a non-DM SPACE. `authUser` authenticates the
 * caller (top-level `user.email`); `sender` (if provided) sets
 * `message.sender` — omit it for command-style messages that arrive without a
 * sender. `mention: true` adds the bot-targeted USER_MENTION annotation used
 * by the `requireMention` path; pass `annotations` directly to control the
 * exact shape (e.g. the simpler `[{ type: 'USER_MENTION' }]` form).
 */
export function makeSpaceMessage(opts: {
  space: string;
  messageId: string;
  text: string;
  authUser?: string;
  sender?: string;
  mention?: boolean;
  annotations?: unknown[];
}): FakeMessage {
  const authUser = opts.authUser ?? 'user@example.com';
  const annotations =
    opts.annotations ??
    (opts.mention
      ? [{ type: 'USER_MENTION', userMention: { user: { type: 'BOT' } } }]
      : undefined);
  return makePubsubMessage({
    type: 'MESSAGE',
    space: { name: opts.space, type: 'SPACE' },
    user: { email: authUser },
    message: {
      name: `${opts.space}/messages/${opts.messageId}`,
      text: opts.text,
      ...(opts.sender ? { sender: { email: opts.sender, type: 'USER' } } : {}),
      ...(annotations ? { annotations } : {}),
    },
  });
}

export interface ChatCreateParams {
  parent: string;
  requestBody: {
    text?: string;
    cardsV2?: unknown[];
    [key: string]: unknown;
  };
}

export interface ChatUpdateParams {
  name: string;
  updateMask: string;
  requestBody: {
    text?: string;
    cardsV2?: unknown[];
    [key: string]: unknown;
  };
}

type ChatCreateFn = (params: ChatCreateParams) => Promise<unknown>;
type ChatUpdateFn = (params: ChatUpdateParams) => Promise<unknown>;

export function makeFakeChatApi() {
  const create = vi.fn<ChatCreateFn>().mockResolvedValue({});
  const update = vi.fn<ChatUpdateFn>().mockResolvedValue({});
  const list = vi.fn().mockResolvedValue({ data: { messages: [] } });
  const api = {
    spaces: {
      messages: { create, update, list },
    },
  } as unknown as GoogleChatApi;
  return { api, create, update, list };
}

/** Find a `chatApi.spaces.messages.create` call by `requestBody.text`. */
export function findCreateByText(
  create: ReturnType<typeof makeFakeChatApi>['create'],
  match: string | ((text: string) => boolean)
): ChatCreateParams | undefined {
  const test = typeof match === 'string' ? (t: string) => t === match : match;
  return create.mock.calls.find(
    ([params]) => typeof params.requestBody.text === 'string' && test(params.requestBody.text)
  )?.[0];
}

/** Find the first `create` call carrying a non-empty `cardsV2` payload. */
export function findCreateWithCard(
  create: ReturnType<typeof makeFakeChatApi>['create']
): ChatCreateParams | undefined {
  return create.mock.calls.find(
    ([params]) => Array.isArray(params.requestBody.cardsV2) && params.requestBody.cardsV2.length > 0
  )?.[0];
}

export function makeFakeSubscription(): MessageSourceLike & {
  emitMessage: (msg: FakeMessage) => void;
} {
  const emitter = new EventEmitter();
  const messageSource = emitter as unknown as MessageSourceLike;
  return Object.assign(messageSource, {
    emitMessage: (msg: FakeMessage) => emitter.emit('message', msg),
  });
}

export interface QueuingFakeSubscription extends MessageSourceLike {
  emitMessage: (msg: FakeMessage) => void;
  detach: () => void;
  pendingCount: () => number;
}

/**
 * Fake Pub/Sub subscription that buffers emitted messages until a 'message'
 * listener is attached, and replays them on attach. Models Pub/Sub's at-least-
 * once redelivery: when the consumer (adapter process) is offline, messages
 * aren't lost — they reappear when a new consumer connects.
 *
 * `detach()` removes the current listener, simulating the adapter crashing/
 * shutting down. Subsequent `emitMessage` calls queue until a fresh
 * `.on('message', ...)` attaches.
 */
export function makeQueuingFakeSubscription(): QueuingFakeSubscription {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let listener: ((msg: any) => void | Promise<void>) | null = null;
  const queue: FakeMessage[] = [];

  const sub: QueuingFakeSubscription = {
    on(event, l) {
      if (event === 'message') {
        listener = l;
        while (queue.length > 0 && listener) {
          const next = queue.shift()!;
          listener(next);
        }
      }
      return sub;
    },
    emitMessage(msg) {
      if (listener) {
        listener(msg);
      } else {
        queue.push(msg);
      }
    },
    detach() {
      listener = null;
    },
    pendingCount() {
      return queue.length;
    },
  };

  return sub;
}

/**
 * Wrap a trpc client so we can observe when `waitForMessages.subscribe` has been
 * acknowledged by the server (SSE `started` frame). Tests `await ready` before
 * sending a message so the forwarder's subscription is guaranteed to be live.
 */
export function instrumentTrpcForReadiness(trpc: ReturnType<typeof getTRPCClient>) {
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

/**
 * Run the daemon → Google Chat forwarder for the duration of `body`. Wraps
 * `trpc` with readiness instrumentation, awaits the SSE `started` frame so
 * body code can rely on the subscription being live, and aborts + joins the
 * forwarder in a finally block so a throwing body doesn't leak it.
 */
export async function runForwarder(
  options: {
    trpc: ReturnType<typeof getTRPCClient>;
    chatApi: GoogleChatApi;
    startDir: string;
    config?: GoogleChatConfig;
    filters?: Record<string, boolean>;
  },
  body: () => Promise<void>
): Promise<void> {
  const { trpc, ready } = instrumentTrpcForReadiness(options.trpc);
  const abort = new AbortController();
  const forwarderPromise = startDaemonToGoogleChatForwarder(
    trpc,
    options.config ?? BASE_CONFIG,
    { filters: options.filters ?? {} },
    abort.signal,
    { chatApi: options.chatApi, startDir: options.startDir }
  );
  try {
    await ready;
    await body();
  } finally {
    abort.abort();
    await forwarderPromise;
  }
}

/**
 * Boilerplate for a Google Chat adapter e2e suite: spins up a dedicated
 * TestEnvironment for the suite and resets adapter state between tests.
 *
 * The reset is queued through `updateGoogleChatState` so it runs after any
 * pending writes (e.g. a late `saveLastMessageId` from the prior test's
 * forwarder) — otherwise those writes could resurrect `channelChatMap`
 * entries after the reset.
 */
export function useGoogleChatAdapterEnv(suiteName: string) {
  const ref: { env: TestEnvironment } = { env: null as unknown as TestEnvironment };

  beforeAll(async () => {
    ref.env = new TestEnvironment(suiteName);
    await ref.env.setup();
    await ref.env.init();
    await ref.env.up();
  }, 30000);

  afterAll(async () => {
    await ref.env.teardown();
  }, 30000);

  afterEach(async () => {
    await ref.env.disconnectAll();
    await updateGoogleChatState(
      () => ({
        lastSyncedMessageIds: {},
        channelChatMap: {},
        oauthTokens: undefined,
        filters: {},
      }),
      ref.env.e2eDir
    );
  });

  return ref;
}
