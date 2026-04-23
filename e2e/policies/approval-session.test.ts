import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import {
  TestEnvironment,
  type ChatSubscription,
  type SystemMessage,
  policyWith,
} from '../_helpers/test-environment.js';

// When an agent requests a policy and the user /approves it, the approval must
// be replayed into the agent's *current* session — not a hard-coded 'default'.
// The current session may have drifted from the one that created the request
// (e.g. session-timeout fired or the user ran /new).
describe('Policy approval runs on the agent\'s current session', () => {
  let env: TestEnvironment;
  let chat: ChatSubscription | undefined;

  beforeAll(async () => {
    env = new TestEnvironment('e2e-approval-session');
    await env.setup();
    await env.setupSubagentEnv({
      policies: {
        'test-cmd': {
          description: 'A test policy',
          command: 'echo',
          args: ['approved-output'],
        },
      },
    });
  }, 30000);

  afterAll(() => env.teardown(), 30000);
  afterEach(() => env.disconnectAll());

  it('replays the approval into the session recorded in chatSettings.sessions, not "default"', async () => {
    const chatId = 'chat-approval-session';
    await env.addChat(chatId, 'debug-agent');

    // Pin the chat's debug-agent session to a known non-'default' id so the
    // bug (falling back to 'default') is observable. In production this drift
    // is what happens after session-timeout or /new.
    env.writeChatSettings(chatId, {
      defaultAgent: 'debug-agent',
      sessions: { 'debug-agent': 'pinned-session-xyz' },
    });

    chat = await env.connect(chatId);

    // Agent requests the policy. This runs in sessionId='pinned-session-xyz'.
    await env.sendMessage('clawmini-lite.js request test-cmd', {
      chat: chatId,
      agent: 'debug-agent',
    });

    const policy = await chat.waitForMessage(policyWith());
    const reqId = policy.requestId;

    await env.sendMessage(`/approve ${reqId}`, { chat: chatId });

    // The second 'policy_approved' system message (displayRole='user') is the
    // one emitted by the re-triggered agent message pipeline. Its sessionId
    // reflects the session the approval was actually replayed on.
    const actorNotif = await chat.waitForMessage(
      (m): m is SystemMessage =>
        m.role === 'system' && m.event === 'policy_approved' && m.displayRole === 'user'
    );

    expect(actorNotif.sessionId).toBe('pinned-session-xyz');
  }, 30000);
});
