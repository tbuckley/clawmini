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
  makePubsubMessage,
  makeQueuingFakeSubscription,
  readState,
  useGoogleChatAdapterEnv,
  writeState,
} from './_google-chat-fixtures.js';

describe('Google Chat Adapter E2E — adapter downtime', () => {
  const envRef = useGoogleChatAdapterEnv('e2e-google-chat-downtime');

  it('processes Pub/Sub messages that arrived while inbound ingestion was down', async () => {
    const { env } = envRef;
    const trpc = getTRPCClient({ socketPath: getSocketPath(env.e2eDir) });
    const subscription = makeQueuingFakeSubscription();
    const { api } = makeFakeChatApi();

    writeState(env.e2eDir, {
      channelChatMap: { 'spaces/dt-in': { chatId: 'gc-dt-in' } },
    });
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

    const msgA = makePubsubMessage({
      type: 'MESSAGE',
      space: { name: 'spaces/dt-in', type: 'DIRECT_MESSAGE', singleUserBotDm: true },
      message: {
        name: 'spaces/dt-in/messages/a',
        sender: { email: 'user@example.com', type: 'USER' },
        text: 'msg A',
      },
    });
    subscription.emitMessage(msgA);

    await chat.waitForMessage((m) => m.role === 'user' && m.content === 'msg A');
    await vi.waitFor(() => expect(msgA.ack).toHaveBeenCalled());

    // Simulate adapter downtime.
    subscription.detach();

    const msgB = makePubsubMessage({
      type: 'MESSAGE',
      space: { name: 'spaces/dt-in', type: 'DIRECT_MESSAGE', singleUserBotDm: true },
      message: {
        name: 'spaces/dt-in/messages/b',
        sender: { email: 'user@example.com', type: 'USER' },
        text: 'msg B',
      },
    });
    const msgC = makePubsubMessage({
      type: 'MESSAGE',
      space: { name: 'spaces/dt-in', type: 'DIRECT_MESSAGE', singleUserBotDm: true },
      message: {
        name: 'spaces/dt-in/messages/c',
        sender: { email: 'user@example.com', type: 'USER' },
        text: 'msg C',
      },
    });
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
    const rawTrpc = getTRPCClient({ socketPath: getSocketPath(env.e2eDir) });
    const { trpc, ready } = instrumentTrpcForReadiness(rawTrpc);
    const { api, create } = makeFakeChatApi();

    writeState(env.e2eDir, {
      channelChatMap: { 'spaces/dt-out': { chatId: 'gc-dt-out' } },
    });
    await env.addChat('gc-dt-out');

    // Scope the forwarder to just `gc-dt-out` so we don't also spin up a
    // default-chat subscription that spams `getMessages` errors.
    // The default agent echoes $CLAW_CLI_MESSAGE into an agent reply, so each
    // env.sendMessage produces exactly one agent-reply create call when we
    // leave filters at their default (agent-only) setting.
    const config = { ...BASE_CONFIG, chatId: 'gc-dt-out' };

    const abort1 = new AbortController();
    const forwarderPromise1 = startDaemonToGoogleChatForwarder(
      trpc,
      config,
      { filters: {} },
      abort1.signal,
      { chatApi: api, startDir: env.e2eDir }
    );

    await ready;

    // Send "msg 1" and wait for it to both land on the chat API and for the
    // lastSyncedMessageIds cursor to advance. That's the durable proof that
    // the state file we'll reopen from holds a real checkpoint.
    await env.sendMessage('msg 1', { chat: 'gc-dt-out', noWait: true });
    await vi.waitFor(
      () => {
        const match = create.mock.calls.find(
          (c) => (c[0] as { requestBody: { text: string } }).requestBody.text === 'msg 1'
        );
        expect(match).toBeDefined();
      },
      { timeout: 10000 }
    );
    await vi.waitFor(() => {
      const id = readState(env.e2eDir).lastSyncedMessageIds?.['gc-dt-out'];
      expect(id).toBeTruthy();
    });
    const cursorAfterMsg1 = readState(env.e2eDir).lastSyncedMessageIds!['gc-dt-out']!;

    // Tear down the forwarder (adapter process exits).
    abort1.abort();
    await forwarderPromise1;

    // Daemon continues to receive messages — these are the ones that would
    // arrive at the forwarder if it were still online.
    await env.sendMessage('msg 2', { chat: 'gc-dt-out', noWait: true });
    await env.sendMessage('msg 3', { chat: 'gc-dt-out', noWait: true });

    // Nothing should have been posted to Google Chat while the forwarder was
    // down.
    expect(
      create.mock.calls.find(
        (c) => (c[0] as { requestBody: { text: string } }).requestBody.text === 'msg 2'
      )
    ).toBeUndefined();
    expect(
      create.mock.calls.find(
        (c) => (c[0] as { requestBody: { text: string } }).requestBody.text === 'msg 3'
      )
    ).toBeUndefined();

    // Restart the forwarder with a fresh abort controller but the same
    // startDir — so it reads back lastSyncedMessageIds and resumes.
    const { trpc: trpc2, ready: ready2 } = instrumentTrpcForReadiness(rawTrpc);
    const abort2 = new AbortController();
    const forwarderPromise2 = startDaemonToGoogleChatForwarder(
      trpc2,
      config,
      { filters: {} },
      abort2.signal,
      { chatApi: api, startDir: env.e2eDir }
    );

    await ready2;

    await vi.waitFor(
      () => {
        const match2 = create.mock.calls.find(
          (c) => (c[0] as { requestBody: { text: string } }).requestBody.text === 'msg 2'
        );
        const match3 = create.mock.calls.find(
          (c) => (c[0] as { requestBody: { text: string } }).requestBody.text === 'msg 3'
        );
        expect(match2).toBeDefined();
        expect(match3).toBeDefined();
      },
      { timeout: 15000 }
    );

    // And the cursor should have advanced past the restart-point.
    await vi.waitFor(() => {
      const now = readState(env.e2eDir).lastSyncedMessageIds?.['gc-dt-out'];
      expect(now).toBeDefined();
      expect(now).not.toBe(cursorAfterMsg1);
    });

    // msg 1 must not be re-posted by the resumed forwarder.
    const msg1Calls = create.mock.calls.filter(
      (c) => (c[0] as { requestBody: { text: string } }).requestBody.text === 'msg 1'
    );
    expect(msg1Calls.length).toBe(1);

    abort2.abort();
    await forwarderPromise2;
  }, 45000);
});
