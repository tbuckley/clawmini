import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import {
  TestEnvironment,
  type ChatSubscription,
  commandWith,
  agentReply,
} from '../_helpers/test-environment.js';

describe('E2E NO_REPLY_NECESSARY short-circuit', () => {
  let env: TestEnvironment;
  let chat: ChatSubscription | undefined;

  beforeAll(async () => {
    env = new TestEnvironment('e2e-no-reply');
    await env.setup();
    await env.init();
    await env.up();
  }, 30000);

  afterAll(() => env.teardown(), 30000);
  afterEach(() => env.disconnectAll());

  it('skips the agent reply when NO_REPLY_NECESSARY appears anywhere in the output', async () => {
    await env.runCli(['agents', 'add', 'no-reply-agent']);
    // Emit the sentinel mid-string to prove the match is a substring, not
    // an exact token equality.
    env.writeAgentSettings('no-reply-agent', {
      commands: { new: 'echo "prefix NO_REPLY_NECESSARY suffix"' },
    });

    await env.addChat('no-reply-chat', 'no-reply-agent');
    chat = await env.connect('no-reply-chat');

    await env.sendMessage('ping', { chat: 'no-reply-chat', agent: 'no-reply-agent' });

    // The command log is always written; only the agent reply should be suppressed.
    await chat.waitForMessage(commandWith('NO_REPLY_NECESSARY'));
    // Give the logger a beat in case an agent reply is (incorrectly) pending.
    await new Promise((r) => setTimeout(r, 300));
    expect(chat.messageBuffer.some((m) => m.role === 'agent')).toBe(false);
  }, 15000);

  it('logs the agent reply when the sentinel is absent', async () => {
    await env.runCli(['agents', 'add', 'reply-agent']);
    env.writeAgentSettings('reply-agent', {
      commands: { new: 'echo "normal reply"' },
    });

    await env.addChat('reply-chat', 'reply-agent');
    chat = await env.connect('reply-chat');

    await env.sendMessage('ping', { chat: 'reply-chat', agent: 'reply-agent' });

    const reply = await chat.waitForMessage(agentReply());
    expect(reply.content.trim()).toBe('normal reply');
  }, 15000);
});
