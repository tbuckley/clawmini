import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { createE2EContext, setupSubagentEnv, waitForLogMatch } from '../_helpers/utils.js';

const { runCli, e2eDir, setupE2E, teardownE2E } = createE2EContext('e2e-timeout-subagents');

describe('Session Timeout Subagents E2E', () => {
  beforeAll(async () => {
    await setupE2E();
    await setupSubagentEnv(runCli, e2eDir, {
      port: 3013,
    });
  }, 30000);

  afterAll(teardownE2E, 30000);

  it('should not schedule a session timeout when a subagent sends a message', async () => {
    await runCli(['chats', 'add', 'chat-timeout']);

    // First, send a normal message so we have a timeout job started from the user.
    await runCli(['messages', 'send', 'hello', '--chat', 'chat-timeout', '--agent', 'debug-agent']);

    // Wait for the user message to be processed
    await waitForLogMatch(e2eDir, 'chat-timeout', /\[DEBUG\] hello/);

    // Now let the subagent spawn a message
    await runCli([
      'messages',
      'send',
      'clawmini-lite.js subagents spawn --async "echo subagent-hello"',
      '--chat',
      'chat-timeout',
      '--agent',
      'debug-agent',
    ]);

    // Wait for async processing
    const match = await waitForLogMatch(e2eDir, 'chat-timeout', /\[DEBUG\] echo subagent-hello:/);
    expect(match).not.toBeNull();

    // Check jobs list to verify no duplicate timeout was scheduled for the subagent interaction
    const chatSettingsPath = path.resolve(e2eDir, '.clawmini/chats/chat-timeout/settings.json');
    const chatSettings = JSON.parse(fs.readFileSync(chatSettingsPath, 'utf8'));
    const jobsList = chatSettings.jobs || [];
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
