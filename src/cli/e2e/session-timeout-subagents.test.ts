import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { createE2EContext } from './utils.js';

const { runCli, e2eDir, setupE2E, teardownE2E } = createE2EContext('e2e-timeout-subagents');

describe('Session Timeout Subagents E2E', () => {
  beforeAll(async () => {
    await setupE2E();
    await runCli(['init']);

    // Add debug agent
    await runCli(['agents', 'add', 'debug-agent', '--template', 'debug']);

    const settingsPath = path.resolve(e2eDir, '.clawmini/settings.json');
    let originalSettings = '{}';
    if (fs.existsSync(settingsPath)) {
      originalSettings = fs.readFileSync(settingsPath, 'utf8');
    }
    const settings = JSON.parse(originalSettings);
    settings.routers = [
      {
        use: '@clawmini/session-timeout',
        with: { timeout: '5s' },
      },
    ];
    settings.api = { host: '127.0.0.1', port: 3013 };
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

    await runCli(['up']);

    const litePath = path.resolve(e2eDir, 'clawmini-lite.js');
    await runCli(['export-lite', '--out', litePath]);
    fs.chmodSync(litePath, '755');

    const binDir = path.resolve(e2eDir, 'bin');
    fs.mkdirSync(binDir);
    fs.symlinkSync(litePath, path.join(binDir, 'clawmini-lite.js'));

    const agentSettingsPath = path.resolve(e2eDir, '.clawmini/agents/debug-agent/settings.json');
    const agentSettings = JSON.parse(fs.readFileSync(agentSettingsPath, 'utf8'));
    agentSettings.env = agentSettings.env || {};
    agentSettings.env.PATH = `${binDir}:${process.env.PATH}`;
    fs.writeFileSync(agentSettingsPath, JSON.stringify(agentSettings, null, 2));
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
    let chatLog = '';
    for (let i = 0; i < 20; i++) {
      if (fs.existsSync(path.resolve(e2eDir, '.clawmini/chats/chat-timeout/chat.jsonl'))) {
        chatLog = fs.readFileSync(
          path.resolve(e2eDir, '.clawmini/chats/chat-timeout/chat.jsonl'),
          'utf8'
        );
        if (chatLog.includes('[DEBUG] echo subagent-hello:')) break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    expect(chatLog).toContain('[DEBUG] echo subagent-hello:');

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
