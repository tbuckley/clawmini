import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { createE2EContext } from './utils.js';

const { runCli, e2eDir, setupE2E, teardownE2E } = createE2EContext('e2e-policy-subagent-exec');

describe('Subagent Policy Execution Routing E2E', () => {
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
    settings.api = { host: '127.0.0.1', port: 3015 };
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

    const policiesPath = path.resolve(e2eDir, '.clawmini/policies.json');
    fs.writeFileSync(
      policiesPath,
      JSON.stringify({
        policies: {
          'test-cmd': {
            description: 'A test policy',
            command: 'echo',
            args: ['policy executed'],
          },
        },
      })
    );

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

  it('should correctly route policy execution result to the subagent instead of the parent agent', async () => {
    await runCli(['chats', 'add', 'chat-exec']);

    // Let the subagent spawn a request
    await runCli([
      'messages',
      'send',
      'clawmini-lite.js subagents spawn --async "clawmini-lite.js request test-cmd"',
      '--chat',
      'chat-exec',
      '--agent',
      'debug-agent',
    ]);

    // Wait for the request to be created by the subagent
    let match: RegExpMatchArray | null = null;
    for (let i = 0; i < 40; i++) {
      const logPath = path.resolve(e2eDir, '.clawmini/chats/chat-exec/chat.jsonl');
      if (fs.existsSync(logPath)) {
        const chatLogBefore = fs.readFileSync(logPath, 'utf8');
        match = chatLogBefore.match(/"requestId":"([^"]+)"/);
        if (match) break;
      }
      await new Promise((r) => setTimeout(r, 250));
    }

    // Call /pending just to maintain test flow
    await runCli(['messages', 'send', '/pending', '--chat', 'chat-exec']);

    expect(match).not.toBeNull();
    const reqId = match![1];

    // Approve the policy
    await runCli(['messages', 'send', `/approve ${reqId}`, '--chat', 'chat-exec']);

    // Wait for approval processing
    let reactionMsg;
    for (let i = 0; i < 40; i++) {
      const logPath = path.resolve(e2eDir, '.clawmini/chats/chat-exec/chat.jsonl');
      if (fs.existsSync(logPath)) {
        const chatLog = fs.readFileSync(logPath, 'utf8');
        const messages = chatLog
          .split('\n')
          .filter((l) => l.trim())
          .map((l) => JSON.parse(l));

        reactionMsg = messages.find(
          (m: any) => m.role === 'agent' && m.content.includes(`Request ${reqId} approved`)
        );
        if (reactionMsg) break;
      }
      await new Promise((r) => setTimeout(r, 250));
    }

    expect(reactionMsg).toBeDefined();

    // The key validation: the reaction must belong to the subagent, NOT the parent agent!
    expect(reactionMsg!.subagentId).toBeDefined();
    expect(reactionMsg!.subagentId.length).toBeGreaterThan(0);
  }, 15000);
});
