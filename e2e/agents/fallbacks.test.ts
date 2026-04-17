import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import {
  TestEnvironment,
  type ChatSubscription,
  commandMatching,
  agentReply,
} from '../_helpers/test-environment.js';

describe('E2E Fallbacks Tests', () => {
  let env: TestEnvironment;
  let chat: ChatSubscription | undefined;

  beforeAll(async () => {
    env = new TestEnvironment('e2e-fallbacks');
    await env.setup();
    await env.init();
    await env.up();
  }, 30000);

  afterAll(() => env.teardown(), 30000);
  afterEach(() => env.disconnectAll());

  it('should fallback when base agent fails with exit code', async () => {
    env.setDefaultAgent({
      commands: {
        new: 'if [ "$SUCCESS" = "true" ]; then echo "Succeeded"; else echo "Failed" >&2; exit 1; fi',
      },
      fallbacks: [{ env: { SUCCESS: 'true' }, retries: 0, delayMs: 100 }],
    });

    await env.addChat('fb-chat-1');
    chat = await env.connect('fb-chat-1');
    await env.sendMessage('test-1', { chat: 'fb-chat-1' });

    const success = await chat.waitForMessage(
      commandMatching((m) => m.stdout.trim() === 'Succeeded' && m.exitCode === 0)
    );
    expect(success).toBeTruthy();
    expect(
      chat.messageBuffer.some((m) => m.role === 'command' && m.content.includes('retrying'))
    ).toBe(true);
  });

  it('should fallback when base agent returns empty content', async () => {
    env.setDefaultAgent({
      commands: {
        new: 'echo "Base output"',
        getMessageContent: 'echo ""',
      },
      fallbacks: [
        {
          commands: { getMessageContent: 'echo "Fallback success"' },
          retries: 0,
          delayMs: 100,
        },
      ],
    });

    await env.addChat('fb-chat-2');
    chat = await env.connect('fb-chat-2');
    await env.sendMessage('test-2', { chat: 'fb-chat-2' });

    const reply = await chat.waitForMessage(agentReply());
    expect(reply.content.trim()).toBe('Fallback success');
  });

  it('should support multiple retries with exponential backoff logs', async () => {
    const attemptFile = path.resolve(env.e2eDir, 'attempts.txt');
    fs.writeFileSync(attemptFile, '0');

    env.setDefaultAgent({
      commands: {
        new: `
          attempts=$(cat ${attemptFile})
          attempts=$((attempts + 1))
          echo $attempts > ${attemptFile}
          if [ $attempts -lt 3 ]; then
            exit 1
          else
            echo "Third time is a charm"
          fi
        `,
      },
      fallbacks: [{ retries: 2, delayMs: 100 }],
    });

    await env.addChat('fb-chat-3');
    chat = await env.connect('fb-chat-3');
    await env.sendMessage('test-3', { chat: 'fb-chat-3' });

    const success = await chat.waitForMessage(
      commandMatching((m) => m.stdout.trim() === 'Third time is a charm')
    );
    expect(success).toBeTruthy();
    expect(
      chat.messageBuffer.filter((m) => m.role === 'command' && m.content.includes('retrying'))
        .length
    ).toBeGreaterThanOrEqual(1);
  }, 10000);

  it('should report final failure when all fallbacks are exhausted', async () => {
    env.setDefaultAgent({
      commands: { new: 'exit 1' },
      fallbacks: [
        {
          commands: { new: 'echo "Fallback 1 fail" && exit 1' },
          retries: 0,
          delayMs: 100,
        },
      ],
    });

    await env.addChat('fb-chat-4');
    chat = await env.connect('fb-chat-4');
    await env.sendMessage('test-4', { chat: 'fb-chat-4' });

    const failure = await chat.waitForMessage(
      commandMatching((m) => m.stdout.trim() === 'Fallback 1 fail' && m.exitCode === 1)
    );
    expect(failure).toBeTruthy();
  });
});
