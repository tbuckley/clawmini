import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { createE2EContext, setupSubagentEnv, waitForLogMatch } from './utils.js';

const { runCli, e2eDir, setupE2E, teardownE2E } = createE2EContext('e2e-timeout-subagents');

describe('Session Timeout Subagents E2E', () => {
  beforeAll(async () => {
    await setupE2E();
    await setupSubagentEnv(runCli, e2eDir, {
      port: 3013,
      routers: [
        {
          use: '@clawmini/session-timeout',
          with: { timeout: '5s' },
        },
      ],
    });
  }, 30000);

  afterAll(teardownE2E, 30000);

  it('should not schedule a session timeout when a subagent sends a message', async () => {
    await runCli(['chats', 'add', 'chat-timeout']);

    // First, send a normal message so we have a timeout job started from the user.
    await runCli(['messages', 'send', 'hello', '--chat', 'chat-timeout', '--agent', 'debug-agent']);

    // Wait a bit to let the user message be logged
    await new Promise((r) => setTimeout(r, 1000));

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
    const timeoutJobsCount = jobsList.filter(
      (j: any) => j.id && j.id.startsWith('__session_timeout__')
    ).length;

    // It should just be the 1 job scheduled from the first message/second message
    expect(timeoutJobsCount).toBe(1);
  }, 15000);
});
