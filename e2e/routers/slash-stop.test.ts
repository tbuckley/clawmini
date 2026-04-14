import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { TestEnvironment, type ChatSubscription } from '../_helpers/test-environment.js';
import type { CommandLogMessage } from '../../src/daemon/chats.js';

describe('/stop Router E2E', () => {
  let env: TestEnvironment;
  let chat: ChatSubscription | undefined;

  beforeAll(async () => {
    env = new TestEnvironment('e2e-slash-stop');
    await env.setup();
    await env.init();
    await env.up();
  }, 30000);

  afterAll(() => env.teardown(), 30000);
  afterEach(async () => {
    await chat?.disconnect();
    chat = undefined;
  });

  it('aborts the in-flight task and suppresses its command log', async () => {
    await env.runCli(['agents', 'add', 'stop-agent']);
    // Output lands only after the sleep, so if /stop aborts correctly, DONE
    // must never appear in the chat.
    env.writeAgentSettings('stop-agent', {
      commands: { new: 'sleep 3 && echo DONE' },
    });

    await env.addChat('stop-chat', 'stop-agent');
    chat = await env.connect('stop-chat');

    await env.sendMessage('long', { chat: 'stop-chat', noWait: true });
    // Give the scheduler a moment to dispatch into runCommand/spawn.
    await new Promise((r) => setTimeout(r, 500));

    await env.sendMessage('/stop', { chat: 'stop-chat', noWait: true });

    // The slash-stop router replies with this synthetic message before aborting.
    await chat.waitForMessage(
      (m) => typeof m.content === 'string' && m.content.includes('Stopping current task...'),
      5000
    );

    // Wait past the original sleep window so any surviving task would have
    // produced output by now.
    await new Promise((r) => setTimeout(r, 3500));
    const leaked = chat.messageBuffer.some(
      (m): m is CommandLogMessage =>
        m.role === 'command' && typeof m.stdout === 'string' && m.stdout.includes('DONE')
    );
    expect(leaked).toBe(false);
  }, 20000);

  it('leaves the session usable for subsequent messages', async () => {
    await env.runCli(['agents', 'add', 'stop-recovery-agent']);
    env.writeAgentSettings('stop-recovery-agent', {
      commands: { new: 'sleep 3 && echo DONE' },
    });

    await env.addChat('stop-recovery-chat', 'stop-recovery-agent');
    chat = await env.connect('stop-recovery-chat');

    await env.sendMessage('long', { chat: 'stop-recovery-chat', noWait: true });
    await new Promise((r) => setTimeout(r, 500));
    await env.sendMessage('/stop', { chat: 'stop-recovery-chat', noWait: true });
    await chat.waitForMessage(
      (m) => typeof m.content === 'string' && m.content.includes('Stopping current task...'),
      5000
    );

    // Swap in a fast-returning command so the follow-up test completes quickly.
    env.writeAgentSettings('stop-recovery-agent', {
      commands: { new: 'echo RECOVERED' },
    });

    await env.sendMessage('after', { chat: 'stop-recovery-chat' });
    const ok = await chat.waitForMessage(
      (m): m is CommandLogMessage =>
        m.role === 'command' && m.stdout.includes('RECOVERED'),
      10000
    );
    expect(ok.exitCode).toBe(0);
  }, 25000);
});
