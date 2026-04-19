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
  findCreateByText,
  makeDmMessage,
  makeFakeChatApi,
  makeQueuingFakeSubscription,
  runForwarder,
  useGoogleChatAdapterEnv,
} from './_google-chat-fixtures.js';

describe('Google Chat Adapter E2E — adapter downtime', () => {
  const envRef = useGoogleChatAdapterEnv('e2e-google-chat-downtime');

  it('processes Pub/Sub messages that arrived while inbound ingestion was down', async () => {
    const { env } = envRef;
    const trpc = getTRPCClient({ socketPath: getSocketPath(env.e2eDir) });
    const subscription = makeQueuingFakeSubscription();
    const { api } = makeFakeChatApi();

    await updateGoogleChatState(
      { channelChatMap: { 'spaces/dt-in': { chatId: 'gc-dt-in' } } },
      env.e2eDir
    );
    await env.addChat('gc-dt-in');
    const chat = await env.connect('gc-dt-in');

    // First ingestion consumer. After it processes msg A we 'detach' it to
    // simulate the adapter crashing, then emit B/C while nothing is listening.
    startGoogleChatIngestion(
      BASE_CONFIG,
      trpc,
      {},
      { subscription, chatApi: api, startDir: env.e2eDir }
    );

    const msgA = makeDmMessage({ space: 'spaces/dt-in', messageId: 'a', text: 'msg A' });
    subscription.emitMessage(msgA);

    await chat.waitForMessage((m) => m.role === 'user' && m.content === 'msg A');
    await vi.waitFor(() => expect(msgA.ack).toHaveBeenCalled());

    // Simulate adapter downtime.
    subscription.detach();

    const msgB = makeDmMessage({ space: 'spaces/dt-in', messageId: 'b', text: 'msg B' });
    const msgC = makeDmMessage({ space: 'spaces/dt-in', messageId: 'c', text: 'msg C' });
    subscription.emitMessage(msgB);
    subscription.emitMessage(msgC);

    // While the adapter is down the messages are buffered (like Pub/Sub's
    // unacked queue), not dropped.
    expect(subscription.pendingCount()).toBe(2);
    expect(msgB.ack).not.toHaveBeenCalled();
    expect(msgC.ack).not.toHaveBeenCalled();

    // A fresh ingestion consumer attaches — equivalent to restarting the
    // adapter process. The buffered messages should replay and reach the
    // daemon in order.
    startGoogleChatIngestion(
      BASE_CONFIG,
      trpc,
      {},
      { subscription, chatApi: api, startDir: env.e2eDir }
    );

    await chat.waitForMessage((m) => m.role === 'user' && m.content === 'msg B');
    await chat.waitForMessage((m) => m.role === 'user' && m.content === 'msg C');
    await vi.waitFor(() => expect(msgB.ack).toHaveBeenCalled());
    await vi.waitFor(() => expect(msgC.ack).toHaveBeenCalled());
  }, 30000);

  it('resumes outbound forwarding from lastSyncedMessageIds after a restart', async () => {
    const { env } = envRef;
    const trpc = getTRPCClient({ socketPath: getSocketPath(env.e2eDir) });
    const { api, create } = makeFakeChatApi();

    await updateGoogleChatState(
      { channelChatMap: { 'spaces/dt-out': { chatId: 'gc-dt-out' } } },
      env.e2eDir
    );
    await env.addChat('gc-dt-out');

    // Scope the forwarder to just `gc-dt-out` so we don't also spin up a
    // default-chat subscription that spams `getMessages` errors.
    // The default agent echoes $CLAW_CLI_MESSAGE into an agent reply, so each
    // env.sendMessage produces exactly one agent-reply create call when we
    // leave filters at their default (agent-only) setting.
    const config = { ...BASE_CONFIG, chatId: 'gc-dt-out' };

    let cursorAfterMsg1 = '';

    await runForwarder({ trpc, chatApi: api, startDir: env.e2eDir, config }, async () => {
      // Send "msg 1" and wait for it to both land on the chat API and for the
      // lastSyncedMessageIds cursor to advance. That's the durable proof that
      // the state file we'll reopen from holds a real checkpoint.
      await env.sendMessage('msg 1', { chat: 'gc-dt-out', noWait: true });
      await vi.waitFor(
        () => {
          expect(findCreateByText(create, 'msg 1')).toBeDefined();
        },
        { timeout: 10000 }
      );
      await vi.waitFor(async () => {
        const id = (await readGoogleChatState(env.e2eDir)).lastSyncedMessageIds?.['gc-dt-out'];
        expect(id).toBeTruthy();
      });
      cursorAfterMsg1 = (await readGoogleChatState(env.e2eDir)).lastSyncedMessageIds![
        'gc-dt-out'
      ]!;
    });

    // Forwarder is now down. Daemon continues to receive messages — these are
    // the ones that would arrive at the forwarder if it were still online.
    await env.sendMessage('msg 2', { chat: 'gc-dt-out', noWait: true });
    await env.sendMessage('msg 3', { chat: 'gc-dt-out', noWait: true });

    // Nothing should have been posted to Google Chat while the forwarder was
    // down.
    expect(findCreateByText(create, 'msg 2')).toBeUndefined();
    expect(findCreateByText(create, 'msg 3')).toBeUndefined();

    // Restart the forwarder with the same startDir — so it reads back
    // lastSyncedMessageIds and resumes.
    await runForwarder({ trpc, chatApi: api, startDir: env.e2eDir, config }, async () => {
      await vi.waitFor(
        () => {
          expect(findCreateByText(create, 'msg 2')).toBeDefined();
          expect(findCreateByText(create, 'msg 3')).toBeDefined();
        },
        { timeout: 15000 }
      );

      // And the cursor should have advanced past the restart-point.
      await vi.waitFor(async () => {
        const now = (await readGoogleChatState(env.e2eDir)).lastSyncedMessageIds?.['gc-dt-out'];
        expect(now).toBeDefined();
        expect(now).not.toBe(cursorAfterMsg1);
      });

      // msg 1 must not be re-posted by the resumed forwarder.
      const msg1Calls = create.mock.calls.filter(
        ([params]) => params.requestBody.text === 'msg 1'
      );
      expect(msg1Calls.length).toBe(1);
    });
  }, 45000);
});
