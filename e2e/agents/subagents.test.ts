import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { createE2EContext } from '../_helpers/utils.js';

const { runCli, e2eDir, setupE2E, teardownE2E } = createE2EContext('e2e-tmp-subagents');

describe('E2E Subagents Tests', () => {
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
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        ...JSON.parse(originalSettings),
        api: { host: '127.0.0.1', port: 3012 },
      })
    );
    await runCli(['up']);

    const litePath = path.resolve(e2eDir, 'clawmini-lite.js');
    await runCli(['export-lite', '--out', litePath]);
    fs.chmodSync(litePath, '755');

    // Create a bin dir and put clawmini-lite.js there so it's in PATH
    const binDir = path.resolve(e2eDir, 'bin');
    fs.mkdirSync(binDir);
    fs.symlinkSync(litePath, path.join(binDir, 'clawmini-lite.js'));

    // Update debug-agent's PATH via settings.json
    const agentSettingsPath = path.resolve(e2eDir, '.clawmini/agents/debug-agent/settings.json');
    const agentSettings = JSON.parse(fs.readFileSync(agentSettingsPath, 'utf8'));
    agentSettings.env = agentSettings.env || {};
    agentSettings.env.PATH = `${binDir}:${process.env.PATH}`;
    fs.writeFileSync(agentSettingsPath, JSON.stringify(agentSettings, null, 2));
  }, 30000);

  afterAll(teardownE2E, 30000);

  it('should return normally when subagent depth limit is not reached', async () => {
    await runCli(['chats', 'add', 'chat-ok']);
    await runCli([
      'messages',
      'send',
      'clawmini-lite.js subagents spawn --async "echo hi"',
      '--chat',
      'chat-ok',
      '--agent',
      'debug-agent',
    ]);

    // Wait for async processing
    let chatLog = '';
    for (let i = 0; i < 20; i++) {
      if (fs.existsSync(path.resolve(e2eDir, '.clawmini/chats/chat-ok/chat.jsonl'))) {
        chatLog = fs.readFileSync(
          path.resolve(e2eDir, '.clawmini/chats/chat-ok/chat.jsonl'),
          'utf8'
        );
        if (chatLog.includes('[DEBUG] echo hi:')) break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    // Check for "[DEBUG] echo hi:" in the output
    expect(chatLog).toContain('[DEBUG] echo hi:');
  }, 15000);

  it('should hit max agent depth limit and trigger an error', async () => {
    await runCli(['chats', 'add', 'chat-limit']);
    await runCli([
      'messages',
      'send',
      'clawmini-lite.js subagents spawn --async "clawmini-lite.js subagents spawn --async \\"clawmini-lite.js subagents spawn --async \\\\\\"echo hi\\\\\\"\\""',
      '--chat',
      'chat-limit',
      '--agent',
      'debug-agent',
    ]);

    let chatLog = '';
    for (let i = 0; i < 20; i++) {
      if (fs.existsSync(path.resolve(e2eDir, '.clawmini/chats/chat-limit/chat.jsonl'))) {
        chatLog = fs.readFileSync(
          path.resolve(e2eDir, '.clawmini/chats/chat-limit/chat.jsonl'),
          'utf8'
        );
        if (chatLog.includes('Max subagent depth reached')) break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    // It should hit max depth limit
    expect(chatLog).toContain('Max subagent depth reached');
    expect(chatLog).not.toContain('[DEBUG] hi:');
  }, 15000);
});
