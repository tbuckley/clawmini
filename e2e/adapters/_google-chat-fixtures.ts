import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { TestEnvironment } from '../_helpers/test-environment.js';
import {
  getTRPCClient,
  type GoogleChatApi,
  type MessageSourceLike,
} from '../../src/adapter-google-chat/client.js';
import type { GoogleChatConfig } from '../../src/adapter-google-chat/config.js';
import {
  updateGoogleChatState,
  type GoogleChatState,
} from '../../src/adapter-google-chat/state.js';

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

export function makeFakeChatApi() {
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

export function makeFakeSubscription(): MessageSourceLike & {
  emitMessage: (msg: FakeMessage) => void;
} {
  const emitter = new EventEmitter();
  const messageSource = emitter as unknown as MessageSourceLike;
  return Object.assign(messageSource, {
    emitMessage: (msg: FakeMessage) => emitter.emit('message', msg),
  });
}

export function readState(e2eDir: string): GoogleChatState {
  const p = path.join(e2eDir, '.clawmini', 'adapters', 'google-chat', 'state.json');
  if (!fs.existsSync(p)) return {};
  return JSON.parse(fs.readFileSync(p, 'utf-8')) as GoogleChatState;
}

export function writeState(e2eDir: string, state: GoogleChatState) {
  const dir = path.join(e2eDir, '.clawmini', 'adapters', 'google-chat');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(state, null, 2));
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
 * Boilerplate for a Google Chat adapter e2e suite: spins up a dedicated
 * TestEnvironment for the suite and resets adapter state between tests.
 *
 * The reset drains pending `updateGoogleChatState` writes before atomically
 * overwriting the state file — otherwise a late `saveLastMessageId` from the
 * prior test's forwarder can resurrect `channelChatMap` entries after
 * `writeState({})` runs.
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
    await updateGoogleChatState({}, ref.env.e2eDir);
    writeState(ref.env.e2eDir, {});
  });

  return ref;
}
