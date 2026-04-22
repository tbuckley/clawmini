import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { TestEnvironment } from '../_helpers/test-environment.js';
import { getTRPCClient } from '../../src/adapter-discord/client.js';
import { getSocketPath } from '../../src/shared/workspace.js';

describe('Discord Adapter Client E2E', () => {
  let env: TestEnvironment;

  beforeAll(async () => {
    env = new TestEnvironment('e2e-discord');
    await env.setup();
    await env.init();
    await env.up();
  }, 30000);

  afterAll(() => env.teardown(), 30000);
  afterEach(() => env.disconnectAll());

  it('should successfully connect to the daemon and subscribe to messages', async () => {
    const socketPath = getSocketPath(env.e2eDir);
    const trpc = getTRPCClient({ socketPath });

    const pingResult = await trpc.ping.query();
    expect(pingResult).toEqual({ status: 'ok' });

    await env.addChat('discord-chat');

    let subscription: { unsubscribe: () => void } | undefined;
    const messages: Record<string, unknown>[] = [];

    await new Promise<void>((resolve, reject) => {
      subscription = trpc.waitForMessages.subscribe(
        { chatId: 'discord-chat' },
        {
          onData: (data) => {
            const items = data as Array<{ kind: string; message?: Record<string, unknown> }>;
            for (const item of items) {
              if (item.kind === 'message' && item.message) messages.push(item.message);
            }
            if (messages.some((m) => m.content === 'hello from adapter e2e test')) {
              resolve();
            }
          },
          onError: (err) => {
            reject(err);
          },
        }
      );

      // Wait a brief moment to ensure subscription is established before sending a message
      setTimeout(async () => {
        try {
          await env.sendMessage('hello from adapter e2e test', {
            chat: 'discord-chat',
            noWait: true,
          });
        } catch (e) {
          reject(e);
        }
      }, 500);

      // Safety timeout
      setTimeout(() => reject(new Error('Timeout waiting for message')), 5000);
    });

    if (subscription) {
      subscription.unsubscribe();
    }

    expect(messages.length).toBeGreaterThan(0);
    const found = messages.find((m) => m.content === 'hello from adapter e2e test');
    expect(found).toBeDefined();
    expect(found!.role).toBe('user');
  });
});
