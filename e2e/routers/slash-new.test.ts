import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { TestEnvironment, type ChatSubscription, commandMatching } from '../_helpers/test-environment.js';

describe('/new Command E2E', () => {
  let env: TestEnvironment;
  let chat: ChatSubscription | undefined;

  beforeAll(async () => {
    env = new TestEnvironment('e2e-slash-new');
    await env.setup();
    await env.runCli(['init', '--agent', 'test-agent', '--agent-template', 'debug']);

    env.updateAgentSettings('test-agent', {
      commands: {
        new: 'echo "[DEBUG NEW $SESSION_ID] $CLAW_CLI_MESSAGE"',
        append: 'echo "[DEBUG APPEND $SESSION_ID] $CLAW_CLI_MESSAGE"',
      },
    });

    await env.up();
  }, 30000);

  afterAll(() => env.teardown(), 30000);
  afterEach(() => env.disconnectAll());

  it('resets the session ID when /new is sent', async () => {
    chat = await env.connect('test-agent');

    const { code } = await env.sendMessage('message 1');
    expect(code).toBe(0);

    await env.sendMessage('message 2');

    const msg2Log = await chat.waitForMessage(
      commandMatching((m) => m.stdout.includes('message 2') && m.stdout.includes('[DEBUG APPEND'))
    );
    const firstSessionId = msg2Log.stdout.match(/\[DEBUG APPEND (.*?)\]/)?.[1];
    expect(firstSessionId).toBeTruthy();

    await env.sendMessage('/new');
    await env.sendMessage('message 3');

    const msg3Log = await chat.waitForMessage(
      commandMatching((m) => m.stdout.includes('message 3') && m.stdout.includes('[DEBUG'))
    );
    expect(msg3Log.stdout).toContain('[DEBUG NEW ]');
    expect(msg3Log.stdout).not.toContain('[DEBUG APPEND');
  }, 30000);
});
