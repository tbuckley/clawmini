import crypto from 'node:crypto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getTRPCClient } from '../../src/adapter-google-chat/client.js';
import { startDaemonToGoogleChatForwarder } from '../../src/adapter-google-chat/forwarder.js';
import { getSocketPath } from '../../src/shared/workspace.js';
import { appendMessage, type ChatMessage } from '../../src/shared/chats.js';
import {
  BASE_CONFIG,
  instrumentTrpcForReadiness,
  makeFakeChatApi,
  readState,
  useGoogleChatAdapterEnv,
  writeState,
} from './_google-chat-fixtures.js';

/**
 * Seed `chatId` with a marker user message and the caller-provided messages,
 * then configure `lastSyncedMessageIds[chatId]` so the forwarder's initial
 * catchup yield starts immediately after the marker. We use direct file
 * appends because there is no tRPC API to inject non-user messages (policy
 * requests, agent replies) into a chat, and those messages have to already be
 * on disk by the time the forwarder subscribes.
 */
async function seedChatForForwarderCatchup(
  startDir: string,
  chatId: string,
  messages: ChatMessage[]
) {
  const marker: ChatMessage = {
    id: crypto.randomUUID(),
    role: 'user',
    content: '__seed_marker__',
    timestamp: new Date().toISOString(),
  };
  await appendMessage(chatId, marker, startDir);
  for (const msg of messages) {
    await appendMessage(chatId, msg, startDir);
  }
  return marker.id;
}

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

  it('renders pending policy-request messages as a cardsV2 payload', async () => {
    const { env } = envRef;
    const rawTrpc = getTRPCClient({ socketPath: getSocketPath(env.e2eDir) });
    const { trpc, ready } = instrumentTrpcForReadiness(rawTrpc);
    const { api, create } = makeFakeChatApi();

    await env.addChat('gc-policy');

    const policyMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'policy',
      content: 'please approve rm -rf /tmp',
      timestamp: new Date().toISOString(),
      messageId: 'm-pol',
      requestId: 'req-pol',
      commandName: 'rm',
      args: ['-rf', '/tmp'],
      status: 'pending',
    };
    const markerId = await seedChatForForwarderCatchup(env.e2eDir, 'gc-policy', [policyMsg]);

    writeState(env.e2eDir, {
      channelChatMap: { 'spaces/policy': { chatId: 'gc-policy' } },
      lastSyncedMessageIds: { 'gc-policy': markerId },
    });

    const forwarderPromise = startDaemonToGoogleChatForwarder(
      trpc,
      BASE_CONFIG,
      { filters: {} },
      abortController.signal,
      { chatApi: api, startDir: env.e2eDir }
    );

    await ready;

    await vi.waitFor(
      () => {
        const cardCall = create.mock.calls.find((c) => {
          const body = c[0] as { requestBody: { cardsV2?: unknown[] } };
          return Array.isArray(body.requestBody.cardsV2) && body.requestBody.cardsV2.length > 0;
        });
        expect(cardCall).toBeDefined();
      },
      { timeout: 10000 }
    );

    const cardCall = create.mock.calls.find((c) => {
      const body = c[0] as { requestBody: { cardsV2?: unknown[] } };
      return Array.isArray(body.requestBody.cardsV2) && body.requestBody.cardsV2.length > 0;
    })!;
    const body = cardCall[0] as {
      parent: string;
      requestBody: {
        text: string;
        cardsV2: Array<{ card: { sections: Array<{ widgets: unknown[] }> } }>;
      };
    };
    expect(body.parent).toBe('spaces/policy');
    expect(body.requestBody.text).toBe('');
    expect(body.requestBody.cardsV2[0]!.card.sections[0]!.widgets.length).toBeGreaterThan(0);

    abortController.abort();
    await forwarderPromise;
  }, 30000);

  it('falls back to plain text when the policy cardsV2 send fails', async () => {
    const { env } = envRef;
    const rawTrpc = getTRPCClient({ socketPath: getSocketPath(env.e2eDir) });
    const { trpc, ready } = instrumentTrpcForReadiness(rawTrpc);
    const { api, create } = makeFakeChatApi();

    // First call (the rich cardsV2 send) throws; subsequent calls (the plain
    // text fallback) resolve. This exercises the catch path in forwarder.ts.
    create.mockImplementationOnce(() => Promise.reject(new Error('card send failed')));

    await env.addChat('gc-policy-fallback');

    const policyMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'policy',
      content: 'please approve dangerous-thing',
      timestamp: new Date().toISOString(),
      messageId: 'm-pol-fb',
      requestId: 'req-pol-fb',
      commandName: 'dangerous-thing',
      args: [],
      status: 'pending',
    };
    const markerId = await seedChatForForwarderCatchup(env.e2eDir, 'gc-policy-fallback', [
      policyMsg,
    ]);

    writeState(env.e2eDir, {
      channelChatMap: { 'spaces/policy-fb': { chatId: 'gc-policy-fallback' } },
      lastSyncedMessageIds: { 'gc-policy-fallback': markerId },
    });

    const forwarderPromise = startDaemonToGoogleChatForwarder(
      trpc,
      BASE_CONFIG,
      { filters: {} },
      abortController.signal,
      { chatApi: api, startDir: env.e2eDir }
    );

    await ready;

    await vi.waitFor(
      () => {
        const plain = create.mock.calls.find((c) => {
          const body = c[0] as { requestBody: { text?: string; cardsV2?: unknown[] } };
          return (
            !body.requestBody.cardsV2 &&
            typeof body.requestBody.text === 'string' &&
            body.requestBody.text.includes('Action Required: Policy Request') &&
            body.requestBody.text.includes('req-pol-fb')
          );
        });
        expect(plain).toBeDefined();
      },
      { timeout: 10000 }
    );

    abortController.abort();
    await forwarderPromise;
  }, 30000);

  it('splits daemon messages longer than 4000 chars into multiple chat API calls', async () => {
    const { env } = envRef;
    const rawTrpc = getTRPCClient({ socketPath: getSocketPath(env.e2eDir) });
    const { trpc, ready } = instrumentTrpcForReadiness(rawTrpc);
    const { api, create } = makeFakeChatApi();

    await env.addChat('gc-chunk');

    const longContent = 'a'.repeat(4000) + 'b'.repeat(3000);
    const longMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: longContent,
      timestamp: new Date().toISOString(),
    };
    const markerId = await seedChatForForwarderCatchup(env.e2eDir, 'gc-chunk', [longMsg]);

    writeState(env.e2eDir, {
      channelChatMap: { 'spaces/chunk': { chatId: 'gc-chunk' } },
      lastSyncedMessageIds: { 'gc-chunk': markerId },
    });

    const forwarderPromise = startDaemonToGoogleChatForwarder(
      trpc,
      BASE_CONFIG,
      { filters: { user: true } },
      abortController.signal,
      { chatApi: api, startDir: env.e2eDir }
    );

    await ready;

    await vi.waitFor(
      () => {
        const chunkCalls = create.mock.calls.filter((c) => {
          const body = c[0] as { parent: string; requestBody: { text: string } };
          return body.parent === 'spaces/chunk' && body.requestBody.text.length > 0;
        });
        // 7000 chars at 4000 per chunk -> 2 calls.
        expect(chunkCalls.length).toBeGreaterThanOrEqual(2);
        const joined = chunkCalls
          .map((c) => (c[0] as { requestBody: { text: string } }).requestBody.text)
          .join('');
        expect(joined).toBe(longContent);
        for (const c of chunkCalls) {
          expect((c[0] as { requestBody: { text: string } }).requestBody.text.length).toBeLessThanOrEqual(
            4000
          );
        }
      },
      { timeout: 15000 }
    );

    abortController.abort();
    await forwarderPromise;
  }, 30000);

  it('formats attached files with a plain-text fallback when Drive upload is disabled', async () => {
    const { env } = envRef;
    const rawTrpc = getTRPCClient({ socketPath: getSocketPath(env.e2eDir) });
    const { trpc, ready } = instrumentTrpcForReadiness(rawTrpc);
    const { api, create } = makeFakeChatApi();

    await env.addChat('gc-files');

    const fileMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'agent',
      content: 'here is the report',
      timestamp: new Date().toISOString(),
      files: ['/tmp/report.pdf', '/tmp/diagram.png'],
    };
    const markerId = await seedChatForForwarderCatchup(env.e2eDir, 'gc-files', [fileMsg]);

    writeState(env.e2eDir, {
      channelChatMap: { 'spaces/files': { chatId: 'gc-files' } },
      lastSyncedMessageIds: { 'gc-files': markerId },
    });

    // Default filters let agent messages through; no overrides needed.
    const forwarderPromise = startDaemonToGoogleChatForwarder(
      trpc,
      BASE_CONFIG,
      { filters: {} },
      abortController.signal,
      { chatApi: api, startDir: env.e2eDir }
    );

    await ready;

    await vi.waitFor(
      () => {
        const fileCall = create.mock.calls.find((c) => {
          const body = c[0] as { parent: string; requestBody: { text: string } };
          return (
            body.parent === 'spaces/files' &&
            body.requestBody.text.includes('here is the report') &&
            body.requestBody.text.includes('(Files generated: report.pdf, diagram.png)')
          );
        });
        expect(fileCall).toBeDefined();
      },
      { timeout: 10000 }
    );

    abortController.abort();
    await forwarderPromise;
  }, 30000);
});
