import { describe, it, expect, vi } from 'vitest';
import {
  getTRPCClient,
  startGoogleChatIngestion,
} from '../../src/adapter-google-chat/client.js';
import { startDaemonToGoogleChatForwarder } from '../../src/adapter-google-chat/forwarder.js';
import { getSocketPath } from '../../src/shared/workspace.js';
import {
  BASE_CONFIG,
  instrumentTrpcForReadiness,
  makeFakeChatApi,
  makeFakeSubscription,
  makePubsubMessage,
  useGoogleChatAdapterEnv,
  writeState,
} from './_google-chat-fixtures.js';

describe('Google Chat Adapter E2E — round-trip (Pub/Sub → daemon → forwarder → chat API)', () => {
  const envRef = useGoogleChatAdapterEnv('e2e-google-chat-roundtrip');

  it('sends an inbound message through the daemon and back out to the chat API', async () => {
    const { env } = envRef;
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
