import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { TestEnvironment, type ChatSubscription } from '../_helpers/test-environment.js';
import type { CommandLogMessage } from '../../src/daemon/chats.js';

describe('Session Timeout Subagents E2E', () => {
  let env: TestEnvironment;
  let chat: ChatSubscription | undefined;

  beforeAll(async () => {
    env = new TestEnvironment('e2e-timeout-subagents');
    await env.setup();
    await env.setupSubagentEnv();
  }, 30000);

  afterAll(() => env.teardown(), 30000);
  afterEach(async () => {
    await chat?.disconnect();
    chat = undefined;
  });

  it('should not schedule a session timeout when a subagent sends a message', async () => {
    await env.runCli(['chats', 'add', 'chat-timeout']);
    chat = await env.connect('chat-timeout');

    // First, send a normal message so we have a timeout job started from the user.
    await env.sendMessage('hello', { chat: 'chat-timeout', agent: 'debug-agent' });
    await chat.waitForMessage(
      (m): m is CommandLogMessage =>
        m.role === 'command' && m.stdout.includes('[DEBUG] hello')
    );

    // Now let the subagent spawn a message
    await env.sendMessage(
      'clawmini-lite.js subagents spawn --async "echo subagent-hello"',
      { chat: 'chat-timeout', agent: 'debug-agent' }
    );
    const subLog = await chat.waitForMessage(
      (m): m is CommandLogMessage =>
        m.role === 'command' && m.stdout.includes('[DEBUG] echo subagent-hello:')
    );
    expect(subLog).toBeTruthy();

    // Check jobs list to verify no duplicate timeout was scheduled for the subagent interaction
    const jobsList = env.getChatSettings('chat-timeout').jobs || [];
    const timeoutJobs = jobsList.filter(
      (j: Record<string, unknown>) =>
        typeof j.id === 'string' && j.id.startsWith('__session_timeout__')
    );

    // It should just be the 1 job scheduled from the first message/second message
    expect(timeoutJobs.length).toBe(1);
    expect(timeoutJobs[0].subagentId).toBeUndefined();
    expect(timeoutJobs[0]).toMatchInlineSnapshot(
      {
        id: expect.stringMatching(/^__session_timeout__/),
        nextSessionId: expect.any(String),
        session: { id: expect.any(String) },
        jobs: { remove: [expect.stringMatching(/^__session_timeout__/)] },
      },
      `
      {
        "env": {
          "__SESSION_TIMEOUT__": "true",
        },
        "id": StringMatching /\\^__session_timeout__/,
        "jobs": {
          "remove": [
            StringMatching /\\^__session_timeout__/,
          ],
        },
        "message": "This chat session has ended. Save any important details from it to your memory. When finished, reply with NO_REPLY_NECESSARY.",
        "nextSessionId": Any<String>,
        "reply": "[@clawmini/session-timeout] Starting a fresh session...",
        "schedule": {
          "at": "60m",
        },
        "session": {
          "id": Any<String>,
          "type": "existing",
        },
      }
    `
    );
  }, 15000);
});
