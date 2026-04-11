import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { createE2EContext } from './utils.js';

const { runCli, e2eDir, setupE2E, teardownE2E } = createE2EContext('e2e-policy-system-msgs');

describe('Policy Confirmation System Messages E2E', () => {
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
    settings.api = { host: '127.0.0.1', port: 3014 };
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

  it('should append a system message to the main chat upon /reject of a policy from a subagent', async () => {
    await runCli(['chats', 'add', 'chat-reject']);

    // Let the subagent spawn a request
    await runCli([
      'messages',
      'send',
      'clawmini-lite.js request test-cmd --async',
      '--chat',
      'chat-reject',
      '--agent',
      'debug-agent',
    ]);

    // Wait a bit
    await new Promise((r) => setTimeout(r, 2000));

    // Get the request ID from pending list
    const { stdout } = await runCli(['messages', 'send', '/pending', '--chat', 'chat-reject']);
    console.log('/pending output:', stdout);

    const chatLogBefore = fs.readFileSync(
      path.resolve(e2eDir, '.clawmini/chats/chat-reject/chat.jsonl'),
      'utf8'
    );
    console.log('chat log before pending:', chatLogBefore);

    const match = chatLogBefore.match(/"requestId":"([^"]+)"/);
    expect(match).not.toBeNull();
    const reqId = match![1];

    // Reject the policy
    await runCli(['messages', 'send', `/reject ${reqId}`, '--chat', 'chat-reject']);

    await new Promise((r) => setTimeout(r, 1000));

    const chatLog = fs.readFileSync(
      path.resolve(e2eDir, '.clawmini/chats/chat-reject/chat.jsonl'),
      'utf8'
    );
    const messages = chatLog
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));

    // We expect a system message with displayRole 'agent', event 'policy_rejected' and no subagentId
    const rejectSysMsg = messages.find(
      (m) =>
        m.role === 'system' &&
        m.event === 'policy_rejected' &&
        m.displayRole === 'agent' &&
        m.content.includes(`Request ${reqId} rejected`)
    );
    expect(rejectSysMsg).toBeDefined();
    expect(rejectSysMsg.subagentId).toBeUndefined();
  }, 15000);

  it('should append a system message to the main chat upon /approve of a policy from a subagent', async () => {
    await runCli(['chats', 'add', 'chat-approve']);

    // Let the subagent spawn a request
    await runCli([
      'messages',
      'send',
      'clawmini-lite.js request test-cmd --async',
      '--chat',
      'chat-approve',
      '--agent',
      'debug-agent',
    ]);

    // Wait a bit
    await new Promise((r) => setTimeout(r, 2000));

    const chatLogBefore = fs.readFileSync(
      path.resolve(e2eDir, '.clawmini/chats/chat-approve/chat.jsonl'),
      'utf8'
    );
    const match = chatLogBefore.match(/"requestId":"([^"]+)"/);
    expect(match).not.toBeNull();
    const reqId = match![1];

    // Approve the policy
    await runCli(['messages', 'send', `/approve ${reqId}`, '--chat', 'chat-approve']);

    await new Promise((r) => setTimeout(r, 1000));

    const chatLog = fs.readFileSync(
      path.resolve(e2eDir, '.clawmini/chats/chat-approve/chat.jsonl'),
      'utf8'
    );
    const messages = chatLog
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));

    // We expect a system message with displayRole 'agent', event 'policy_approved' and no subagentId
    const approveSysMsg = messages.find(
      (m) =>
        m.role === 'system' &&
        m.event === 'policy_approved' &&
        m.displayRole === 'agent' &&
        m.content.includes(`Request ${reqId} approved.`)
    );
    expect(approveSysMsg).toBeDefined();
    expect(approveSysMsg.subagentId).toBeUndefined();
  }, 15000);
});
