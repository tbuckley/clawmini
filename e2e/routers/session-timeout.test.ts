import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { TestEnvironment, type ChatSubscription, commandMatching } from '../_helpers/test-environment.js';

describe('Session Timeout E2E', () => {
  let env: TestEnvironment;
  let chat: ChatSubscription | undefined;

  beforeAll(async () => {
    env = new TestEnvironment('e2e-timeout');
    await env.setup();
    await env.runCli(['init', '--agent', 'test-agent', '--agent-template', 'debug']);

    env.updateSettings({
      routers: [{ use: '@clawmini/session-timeout', with: { timeout: '5s' } }],
    });

    const agentSettings = env.getAgentSettings('test-agent');
    const commands = agentSettings.commands as Record<string, unknown>;
    commands.new = 'echo "[DEBUG NEW $SESSION_ID] $CLAW_CLI_MESSAGE"';
    commands.append = 'echo "[DEBUG APPEND $SESSION_ID] $CLAW_CLI_MESSAGE"';
    env.writeAgentSettings('test-agent', agentSettings);

    await env.up();
  }, 30000);

  afterAll(() => env.teardown(), 30000);
  afterEach(() => env.disconnectAll());

  it('fires the timeout job and routes the next message to a new session', async () => {
    // `init --agent test-agent` sets the default chat id to 'test-agent'.
    chat = await env.connect('test-agent');

    const { code } = await env.sendMessage('first message');
    expect(code).toBe(0);

    const { stdout: jobsList } = await env.runCli(['jobs', 'list']);
    expect(jobsList).toContain('__session_timeout__');

    // Wait for the automated fresh-session reply after the 5s timeout fires.
    await chat.waitForMessage(
      (m) =>
        typeof m.content === 'string' &&
        m.content.includes('[@clawmini/session-timeout] Starting a fresh session...'),
      10000
    );

    await env.sendMessage('second message');

    // The second message should use `commands.new` with an empty SESSION_ID.
    const secondMsgLog = await chat.waitForMessage(
      commandMatching((m) => m.stdout.includes('second message') && m.stdout.includes('[DEBUG'))
    );
    expect(secondMsgLog.stdout).toContain('[DEBUG NEW ]');
    expect(secondMsgLog.stdout).not.toContain('[DEBUG APPEND ');
  }, 20000);

  it('/new before timeout: old session gets a background prompt, no user-facing fresh-session notice', async () => {
    await env.runCli(['chats', 'add', 'test2']);
    chat = await env.connect('test2');

    await env.sendMessage('msg A', { chat: 'test2', agent: 'test-agent' });
    await env.sendMessage('/new', { chat: 'test2' });
    await env.sendMessage('msg B', { chat: 'test2' });

    // After 2s the msg A timer is at 2.5s, msg B timer is ~2s.
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Keep-alive resets the current session's timeout to 5s from now.
    await env.sendMessage('msg KEEP ALIVE', { chat: 'test2' });

    const keepAliveLog = await chat.waitForMessage(
      commandMatching(
        (m) => m.stdout.includes('msg KEEP ALIVE') && m.stdout.includes('[DEBUG APPEND')
      )
    );
    const keepAliveSessionId = keepAliveLog.stdout.match(/\[DEBUG APPEND (.*?)\]/)?.[1];
    expect(keepAliveSessionId).toBeTruthy();

    // Wait another 3.5s: msg A is ~6s old (timer fired); keep-alive is ~3.5s (still fresh).
    await new Promise((resolve) => setTimeout(resolve, 3500));

    // The user should NOT be told the session was refreshed — /new already ended that session.
    expect(
      chat.messageBuffer.some(
        (m) =>
          typeof m.content === 'string' &&
          m.content.includes('[@clawmini/session-timeout] Starting a fresh session...')
      )
    ).toBe(false);

    // But the background prompt SHOULD have fired for msg A's (already-ended) session.
    const backgroundPrompts = chat.messageBuffer.filter(
      (m) => typeof m.content === 'string' && m.content.includes('This chat session has ended.')
    );
    expect(backgroundPrompts.length).toBeGreaterThanOrEqual(1);

    // Current session wasn't blown away by msg A's timeout.
    await env.sendMessage('msg C', { chat: 'test2' });
    const msgCLog = await chat.waitForMessage(
      commandMatching((m) => m.stdout.includes('msg C') && m.stdout.includes('[DEBUG'))
    );
    expect(msgCLog.stdout).toContain(`[DEBUG APPEND ${keepAliveSessionId}]`);
  }, 20000);
});
