import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getTRPCClient } from '../../src/adapter-google-chat/client.js';
import { startDaemonToGoogleChatForwarder } from '../../src/adapter-google-chat/forwarder.js';
import { getSocketPath } from '../../src/shared/workspace.js';
import {
  BASE_CONFIG,
  instrumentTrpcForReadiness,
  makeFakeChatApi,
  readState,
  useGoogleChatAdapterEnv,
  writeState,
} from './_google-chat-fixtures.js';

describe('Google Chat Adapter E2E — outbound (daemon → chat API via forwarder)', () => {
  const envRef = useGoogleChatAdapterEnv('e2e-google-chat-outbound');
  let abortController: AbortController;

  beforeEach(() => {
    abortController = new AbortController();
  });

  afterEach(() => {
    abortController.abort();
  });

  it('forwards agent-visible messages from the daemon to the chat API', async () => {
    const { env } = envRef;
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
    const { env } = envRef;
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
      (c) => (c[0] as { requestBody: { text: string } }).requestBody.text === 'unmapped payload'
    );
    expect(match).toBeUndefined();

    abortController.abort();
    await forwarderPromise;
  }, 30000);
});
