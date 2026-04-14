import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createE2EContext } from '../_helpers/utils.js';
import { getTRPCClient } from '../../src/adapter-discord/client.js';
import { getSocketPath } from '../../src/shared/workspace.js';

const { runCli, e2eDir, setupE2E, teardownE2E } = createE2EContext('e2e-discord');
describe('Discord Adapter Client E2E', () => {
  beforeAll(async () => {
    await setupE2E();
    await runCli(['init']);
    await runCli(['up']);
  }, 30000);

  afterAll(async () => {
    await runCli(['down']);
    await teardownE2E();
  }, 30000);

  it('should successfully connect to the daemon and subscribe to messages', async () => {
    const socketPath = getSocketPath(e2eDir);
    const trpc = getTRPCClient({ socketPath });

    const pingResult = await trpc.ping.query();
    expect(pingResult).toEqual({ status: 'ok' });

    await runCli(['chats', 'add', 'discord-chat']);

    let subscription: { unsubscribe: () => void } | undefined;
    const messages: Record<string, unknown>[] = [];

    await new Promise<void>((resolve, reject) => {
      subscription = trpc.waitForMessages.subscribe(
        { chatId: 'discord-chat' },
        {
          onData: (data) => {
            messages.push(...(data as Record<string, unknown>[]));
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
          await runCli([
            'messages',
            'send',
            'hello from adapter e2e test',
            '--chat',
            'discord-chat',
            '--no-wait',
          ]);
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
