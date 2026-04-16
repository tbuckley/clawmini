import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { TestEnvironment, type ChatSubscription, commandMatching } from '../_helpers/test-environment.js';

describe('E2E Agent Interrupt + Pending Message Merge', () => {
  let env: TestEnvironment;
  let chat: ChatSubscription | undefined;

  beforeAll(async () => {
    env = new TestEnvironment('e2e-agent-interrupt');
    await env.setup();
    await env.init();
    await env.up();
  }, 30000);

  afterAll(() => env.teardown(), 30000);
  afterEach(() => env.disconnectAll());

  it('aborts the active task and prepends pending payloads to the new message', async () => {
    await env.runCli(['agents', 'add', 'interrupt-agent']);
    env.writeAgentSettings('interrupt-agent', {
      // Echo the message we were invoked with so the final merged content lands
      // in the command log's stdout, then sleep long enough that the first
      // run is still active when /interrupt arrives.
      commands: { new: 'echo "RAN: $CLAW_CLI_MESSAGE" && sleep 2' },
    });

    await env.addChat('interrupt-chat', 'interrupt-agent');
    chat = await env.connect('interrupt-chat');

    // first: becomes the active task
    await env.sendMessage('first', { chat: 'interrupt-chat', noWait: true });
    // Give the scheduler a moment to dispatch it into runCommand.
    await new Promise((r) => setTimeout(r, 300));

    // second: queues behind first
    await env.sendMessage('second', { chat: 'interrupt-chat', noWait: true });
    // third: /interrupt aborts first, extracts second's payload, and prepends both
    // as <message>...</message> blocks to "third".
    await env.sendMessage('/interrupt third', { chat: 'interrupt-chat', noWait: true });

    const mergedLog = await chat.waitForMessage(
      commandMatching((m) => m.stdout.includes('RAN:') && m.stdout.includes('third')),
      20000
    );

    expect(mergedLog.stdout).toContain('<message>\nfirst\n</message>');
    expect(mergedLog.stdout).toContain('<message>\nsecond\n</message>');
    expect(mergedLog.stdout).toContain('<message>\nthird\n</message>');
  }, 30000);
});
