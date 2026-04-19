import crypto from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import { getTRPCClient } from '../../src/adapter-google-chat/client.js';
import {
  readGoogleChatState,
  updateGoogleChatState,
} from '../../src/adapter-google-chat/state.js';
import { getSocketPath } from '../../src/shared/workspace.js';
import { appendMessage, type ChatMessage } from '../../src/shared/chats.js';
import {
  findCreateByText,
  findCreateWithCard,
  makeFakeChatApi,
  runForwarder,
  useGoogleChatAdapterEnv,
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
    sessionId: undefined,
  };
  await appendMessage(chatId, marker, startDir);
  for (const msg of messages) {
    await appendMessage(chatId, msg, startDir);
  }
  return marker.id;
}

describe('Google Chat Adapter E2E — outbound (daemon → chat API via forwarder)', () => {
  const envRef = useGoogleChatAdapterEnv('e2e-google-chat-outbound');

  it('forwards agent-visible messages from the daemon to the chat API', async () => {
    const { env } = envRef;
    const trpc = getTRPCClient({ socketPath: getSocketPath(env.e2eDir) });
    const { api, create } = makeFakeChatApi();

    // Map a fake space to our chat so the forwarder knows where to post.
    await updateGoogleChatState(
      { channelChatMap: { 'spaces/outbound': { chatId: 'gc-chat' } } },
      env.e2eDir
    );
    await env.addChat('gc-chat');

    // user-role messages are filtered out by default; allow them through so we don't need
    // a real agent to produce the side of the conversation.
    await runForwarder(
      { trpc, chatApi: api, startDir: env.e2eDir, filters: { user: true } },
      async () => {
        await env.sendMessage('outbound payload', { chat: 'gc-chat', noWait: true });

        await vi.waitFor(
          () => {
            expect(findCreateByText(create, 'outbound payload')).toBeDefined();
          },
          { timeout: 10000 }
        );

        expect(findCreateByText(create, 'outbound payload')!.parent).toBe('spaces/outbound');
      }
    );
  }, 30000);

  it('drops messages when no mapped space exists for the chat', async () => {
    const { env } = envRef;
    const trpc = getTRPCClient({ socketPath: getSocketPath(env.e2eDir) });
    const { api, create } = makeFakeChatApi();

    // No channelChatMap entry → forwarder should advance lastSyncedMessageIds but not post.
    await env.addChat('gc-chat');

    await runForwarder(
      { trpc, chatApi: api, startDir: env.e2eDir, filters: { user: true } },
      async () => {
        // Capture the forwarder's baseline cursor (it seeds to the chat's current latest
        // message id on start), then send and wait for that cursor to advance — which
        // proves the drop path executed without relying on a wall-clock delay.
        const baseline = (await readGoogleChatState(env.e2eDir)).lastSyncedMessageIds?.['gc-chat'];
        await env.sendMessage('unmapped payload', { chat: 'gc-chat', noWait: true });

        await vi.waitFor(
          async () => {
            const cur = (await readGoogleChatState(env.e2eDir)).lastSyncedMessageIds?.['gc-chat'];
            expect(cur).toBeDefined();
            expect(cur).not.toBe(baseline);
          },
          { timeout: 10000 }
        );

        expect(findCreateByText(create, 'unmapped payload')).toBeUndefined();
      }
    );
  }, 30000);

  it('renders pending policy-request messages as a cardsV2 payload', async () => {
    const { env } = envRef;
    const trpc = getTRPCClient({ socketPath: getSocketPath(env.e2eDir) });
    const { api, create } = makeFakeChatApi();

    await env.addChat('gc-policy');

    const policyMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'policy',
      content: 'please approve rm -rf /tmp',
      timestamp: new Date().toISOString(),
      sessionId: undefined,
      messageId: 'm-pol',
      requestId: 'req-pol',
      commandName: 'rm',
      args: ['-rf', '/tmp'],
      status: 'pending',
    };
    const markerId = await seedChatForForwarderCatchup(env.e2eDir, 'gc-policy', [policyMsg]);

    await updateGoogleChatState(
      {
        channelChatMap: { 'spaces/policy': { chatId: 'gc-policy' } },
        lastSyncedMessageIds: { 'gc-policy': markerId },
      },
      env.e2eDir
    );

    await runForwarder({ trpc, chatApi: api, startDir: env.e2eDir }, async () => {
      await vi.waitFor(
        () => {
          expect(findCreateWithCard(create)).toBeDefined();
        },
        { timeout: 10000 }
      );

      const cardCall = findCreateWithCard(create)!;
      expect(cardCall.parent).toBe('spaces/policy');
      expect(cardCall.requestBody.text).toBe('');
      const cards = cardCall.requestBody.cardsV2 as Array<{
        card: { sections: Array<{ widgets: unknown[] }> };
      }>;
      expect(cards[0]!.card.sections[0]!.widgets.length).toBeGreaterThan(0);
    });
  }, 30000);

  it('falls back to plain text when the policy cardsV2 send fails', async () => {
    const { env } = envRef;
    const trpc = getTRPCClient({ socketPath: getSocketPath(env.e2eDir) });
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
      sessionId: undefined,
      messageId: 'm-pol-fb',
      requestId: 'req-pol-fb',
      commandName: 'dangerous-thing',
      args: [],
      status: 'pending',
    };
    const markerId = await seedChatForForwarderCatchup(env.e2eDir, 'gc-policy-fallback', [
      policyMsg,
    ]);

    await updateGoogleChatState(
      {
        channelChatMap: { 'spaces/policy-fb': { chatId: 'gc-policy-fallback' } },
        lastSyncedMessageIds: { 'gc-policy-fallback': markerId },
      },
      env.e2eDir
    );

    await runForwarder({ trpc, chatApi: api, startDir: env.e2eDir }, async () => {
      await vi.waitFor(
        () => {
          const plain = findCreateByText(
            create,
            (text) =>
              text.includes('Action Required: Policy Request') && text.includes('req-pol-fb')
          );
          expect(plain).toBeDefined();
          expect(plain!.requestBody.cardsV2).toBeUndefined();
        },
        { timeout: 10000 }
      );
    });
  }, 30000);

  it('splits daemon messages longer than 4000 chars into multiple chat API calls', async () => {
    const { env } = envRef;
    const trpc = getTRPCClient({ socketPath: getSocketPath(env.e2eDir) });
    const { api, create } = makeFakeChatApi();

    await env.addChat('gc-chunk');

    const longContent = 'a'.repeat(4000) + 'b'.repeat(3000);
    const longMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: longContent,
      timestamp: new Date().toISOString(),
      sessionId: undefined,
    };
    const markerId = await seedChatForForwarderCatchup(env.e2eDir, 'gc-chunk', [longMsg]);

    await updateGoogleChatState(
      {
        channelChatMap: { 'spaces/chunk': { chatId: 'gc-chunk' } },
        lastSyncedMessageIds: { 'gc-chunk': markerId },
      },
      env.e2eDir
    );

    await runForwarder(
      { trpc, chatApi: api, startDir: env.e2eDir, filters: { user: true } },
      async () => {
        await vi.waitFor(
          () => {
            const chunkCalls = create.mock.calls
              .map(([params]) => params)
              .filter((p) => p.parent === 'spaces/chunk' && (p.requestBody.text?.length ?? 0) > 0);
            // 7000 chars at 4000 per chunk -> 2 calls.
            expect(chunkCalls.length).toBeGreaterThanOrEqual(2);
            const joined = chunkCalls.map((p) => p.requestBody.text ?? '').join('');
            expect(joined).toBe(longContent);
            for (const p of chunkCalls) {
              expect(p.requestBody.text!.length).toBeLessThanOrEqual(4000);
            }
          },
          { timeout: 15000 }
        );
      }
    );
  }, 30000);

  it('formats attached files with a plain-text fallback when Drive upload is disabled', async () => {
    const { env } = envRef;
    const trpc = getTRPCClient({ socketPath: getSocketPath(env.e2eDir) });
    const { api, create } = makeFakeChatApi();

    await env.addChat('gc-files');

    const fileMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'agent',
      content: 'here is the report',
      timestamp: new Date().toISOString(),
      sessionId: undefined,
      files: ['/tmp/report.pdf', '/tmp/diagram.png'],
    };
    const markerId = await seedChatForForwarderCatchup(env.e2eDir, 'gc-files', [fileMsg]);

    await updateGoogleChatState(
      {
        channelChatMap: { 'spaces/files': { chatId: 'gc-files' } },
        lastSyncedMessageIds: { 'gc-files': markerId },
      },
      env.e2eDir
    );

    // Default filters let agent messages through; no overrides needed.
    await runForwarder({ trpc, chatApi: api, startDir: env.e2eDir }, async () => {
      await vi.waitFor(
        () => {
          const fileCall = findCreateByText(
            create,
            (text) =>
              text.includes('here is the report') &&
              text.includes('(Files generated: report.pdf, diagram.png)')
          );
          expect(fileCall).toBeDefined();
          expect(fileCall!.parent).toBe('spaces/files');
        },
        { timeout: 10000 }
      );
    });
  }, 30000);
});
