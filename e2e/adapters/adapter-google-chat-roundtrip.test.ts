import { describe, it, expect, vi } from 'vitest';
import {
  getTRPCClient,
  startGoogleChatIngestion,
} from '../../src/adapter-google-chat/client.js';
import { updateGoogleChatState } from '../../src/adapter-google-chat/state.js';
import { getSocketPath } from '../../src/shared/workspace.js';
import {
  BASE_CONFIG,
  findCreateByText,
  makeDmMessage,
  makeFakeChatApi,
  makeFakeSubscription,
  runForwarder,
  useGoogleChatAdapterEnv,
} from './_google-chat-fixtures.js';

describe('Google Chat Adapter E2E — round-trip (Pub/Sub → daemon → forwarder → chat API)', () => {
  const envRef = useGoogleChatAdapterEnv('e2e-google-chat-roundtrip');

  it('sends an inbound message through the daemon and back out to the chat API', async () => {
    const { env } = envRef;
    const trpc = getTRPCClient({ socketPath: getSocketPath(env.e2eDir) });
    const subscription = makeFakeSubscription();
    const { api, create } = makeFakeChatApi();

    await updateGoogleChatState(
      { channelChatMap: { 'spaces/roundtrip': { chatId: 'gc-chat' } } },
      env.e2eDir
    );
    await env.addChat('gc-chat');

    startGoogleChatIngestion(
      BASE_CONFIG,
      trpc,
      {},
      { subscription, chatApi: api, startDir: env.e2eDir }
    );

    await runForwarder(
      { trpc, chatApi: api, startDir: env.e2eDir, filters: { user: true } },
      async () => {
        subscription.emitMessage(
          makeDmMessage({ space: 'spaces/roundtrip', messageId: 'rt1', text: 'round trip' })
        );

        await vi.waitFor(
          () => {
            expect(findCreateByText(create, 'round trip')).toBeDefined();
          },
          { timeout: 10000 }
        );
      }
    );
  }, 30000);
});
