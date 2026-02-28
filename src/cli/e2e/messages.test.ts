import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { createE2EContext } from './utils.js';

const { runCli, e2eDir, setupE2E, teardownE2E } = createE2EContext('e2e-tmp-messages');

describe('E2E Messages Tests', () => {
  beforeAll(async () => {
    await setupE2E();
    await runCli(['init']);
  }, 30000);

  afterAll(teardownE2E, 30000);

  it('should send a message via the daemon', async () => {
    const { stdout, code } = await runCli(['messages', 'send', 'e2e test message']);

    expect(code).toBe(0);
    expect(stdout).toContain('Message sent successfully.');

    const daemonLog = fs.readFileSync(path.resolve(e2eDir, '.clawmini/daemon.log'), 'utf8');
    expect(daemonLog).toContain('e2e test message');
  });

  it('should send a message to a specific chat', async () => {
    await runCli(['chats', 'add', 'specific-chat']);
    const { stdout, code } = await runCli([
      'messages',
      'send',
      'specific chat message',
      '--chat',
      'specific-chat',
    ]);

    expect(code).toBe(0);
    expect(stdout).toContain('Message sent successfully.');

    await new Promise((resolve) => setTimeout(resolve, 500));

    const chatLog = fs.readFileSync(
      path.resolve(e2eDir, '.clawmini/chats/specific-chat/chat.jsonl'),
      'utf8'
    );
    expect(chatLog).toContain('specific chat message');
  });

  it('should send a message with a specific session ID', async () => {
    await runCli(['chats', 'add', 'session-chat']);
    const { stdout, code } = await runCli([
      'messages',
      'send',
      'session test message',
      '--chat',
      'session-chat',
      '--session',
      'my-test-session',
    ]);

    expect(code).toBe(0);
    expect(stdout).toContain('Message sent successfully.');

    await new Promise((resolve) => setTimeout(resolve, 500));

    const chatLog = fs.readFileSync(
      path.resolve(e2eDir, '.clawmini/chats/session-chat/chat.jsonl'),
      'utf8'
    );
    expect(chatLog).toContain('session test message');
  });

  it('should send a message with a specific agent and persist it', async () => {
    await runCli(['agents', 'add', 'custom-agent', '--env', 'CUSTOM_VAR=HELLO']);
    await runCli(['chats', 'add', 'agent-chat']);

    const { stdout, code } = await runCli([
      'messages',
      'send',
      'hello custom agent',
      '--chat',
      'agent-chat',
      '--agent',
      'custom-agent',
    ]);

    expect(code).toBe(0);
    expect(stdout).toContain('Message sent successfully.');

    const chatSettingsPath = path.resolve(e2eDir, '.clawmini/chats/agent-chat/settings.json');
    expect(fs.existsSync(chatSettingsPath)).toBe(true);
    const chatSettings = JSON.parse(fs.readFileSync(chatSettingsPath, 'utf8'));
    expect(chatSettings.defaultAgent).toBe('custom-agent');

    const { stderr: stderrFail, code: codeFail } = await runCli([
      'messages',
      'send',
      'fail msg',
      '--chat',
      'agent-chat',
      '--agent',
      'non-existent-agent',
    ]);

    expect(codeFail).toBe(1);
    expect(stderrFail).toContain("Error: Agent 'non-existent-agent' not found.");
  });

  it('should view history with tail and --json flag', async () => {
    const { stdout, code } = await runCli(['messages', 'tail', '--chat', 'specific-chat']);
    expect(code).toBe(0);
    expect(stdout).toContain('[USER]');
    expect(stdout).toContain('specific chat message');

    const { stdout: jsonStdout, code: jsonCode } = await runCli([
      'messages',
      'tail',
      '--json',
      '--chat',
      'specific-chat',
    ]);
    expect(jsonCode).toBe(0);
    expect(jsonStdout).toContain('"role":"user"');
    expect(jsonStdout).toContain('"content":"specific chat message"');
  });

  it('should return immediately with --no-wait flag', async () => {
    await runCli(['chats', 'add', 'nowait-chat']);

    const { stdout, code } = await runCli([
      'messages',
      'send',
      'no wait message',
      '--chat',
      'nowait-chat',
      '--no-wait',
    ]);

    expect(code).toBe(0);
    expect(stdout).toContain('Message sent successfully.');

    await new Promise((resolve) => setTimeout(resolve, 500));

    const chatLog = fs.readFileSync(
      path.resolve(e2eDir, '.clawmini/chats/nowait-chat/chat.jsonl'),
      'utf8'
    );
    expect(chatLog).toContain('no wait message');
  });

  it('should maintain atomic ordering of user and log messages with --no-wait', async () => {
    const settingsPath = path.resolve(e2eDir, '.clawmini/settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const oldCmd = settings.defaultAgent?.commands?.new;

    settings.defaultAgent = settings.defaultAgent || {};
    settings.defaultAgent.commands = settings.defaultAgent.commands || {};
    settings.defaultAgent.commands.new = 'sleep 0.2 && echo $CLAW_CLI_MESSAGE';
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

    await runCli(['chats', 'add', 'order-chat']);

    await runCli(['messages', 'send', 'first', '--chat', 'order-chat', '--no-wait']);
    await runCli(['messages', 'send', 'second', '--chat', 'order-chat', '--no-wait']);

    await new Promise((resolve) => setTimeout(resolve, 1500));

    settings.defaultAgent.commands.new = oldCmd;
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

    const chatLog = fs.readFileSync(
      path.resolve(e2eDir, '.clawmini/chats/order-chat/chat.jsonl'),
      'utf8'
    );
    const lines = chatLog
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));

    expect(lines).toHaveLength(4);
    expect(lines[0].role).toBe('user');
    expect(lines[0].content).toBe('first');
    expect(lines[1].role).toBe('user');
    expect(lines[1].content).toBe('second');
    expect(lines[2].role).toBe('log');
    expect(lines[2].content.trim()).toBe('first');
    expect(lines[3].role).toBe('log');
    expect(lines[3].content.trim()).toBe('second');
  });

  it('should handle full multi-message session workflow (extraction & append)', async () => {
    const settingsPath = path.resolve(e2eDir, '.clawmini/settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const oldCmds = settings.defaultAgent?.commands || {};

    settings.defaultAgent = settings.defaultAgent || {};
    settings.defaultAgent.commands = {
      new: 'echo "NEW $CLAW_CLI_MESSAGE" && echo "ERR NEW" >&2',
      append: 'echo "APPEND $CLAW_CLI_MESSAGE" && echo "ERR APPEND" >&2',
      getSessionId: 'echo "session-123"',
      getMessageContent: 'sed "s/^/EXTRACTED-/"',
    };
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

    await runCli(['chats', 'add', 'workflow-chat']);

    await runCli(['messages', 'send', 'msg-1', '--chat', 'workflow-chat']);
    await new Promise((resolve) => setTimeout(resolve, 800));

    const chatLogPath = path.resolve(e2eDir, '.clawmini/chats/workflow-chat/chat.jsonl');
    let chatLog = fs.readFileSync(chatLogPath, 'utf8');
    let lines = chatLog
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));

    expect(lines).toHaveLength(2);
    expect(lines[1].command).toBe('echo "NEW $CLAW_CLI_MESSAGE" && echo "ERR NEW" >&2');
    expect(lines[1].content).toContain('EXTRACTED-NEW msg-1');
    expect(lines[1].stderr).toContain('ERR NEW');
    expect(lines[1].stdout).toContain('NEW msg-1');

    const sessionSettings = JSON.parse(
      fs.readFileSync(
        path.resolve(e2eDir, '.clawmini/agents/default/sessions/default/settings.json'),
        'utf8'
      )
    );
    expect(sessionSettings.env.SESSION_ID).toBe('session-123');

    await runCli(['messages', 'send', 'msg-2', '--chat', 'workflow-chat']);
    await new Promise((resolve) => setTimeout(resolve, 800));

    chatLog = fs.readFileSync(chatLogPath, 'utf8');
    lines = chatLog
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));

    expect(lines).toHaveLength(4);
    expect(lines[3].command).toBe('echo "APPEND $CLAW_CLI_MESSAGE" && echo "ERR APPEND" >&2');
    expect(lines[3].content).toContain('EXTRACTED-APPEND msg-2');
    expect(lines[3].stderr).toContain('ERR APPEND');
    expect(lines[3].stdout).toContain('APPEND msg-2');

    settings.defaultAgent.commands.getMessageContent = 'echo "EXTRACTION_FAIL" >&2 && exit 1';
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

    await runCli(['messages', 'send', 'msg-3', '--chat', 'workflow-chat']);
    await new Promise((resolve) => setTimeout(resolve, 800));

    chatLog = fs.readFileSync(chatLogPath, 'utf8');
    lines = chatLog
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));

    expect(lines).toHaveLength(6);
    expect(lines[5].stdout).toBeUndefined();
    expect(lines[5].stderr).toContain('ERR APPEND');
    expect(lines[5].stderr).toContain('getMessageContent failed: EXTRACTION_FAIL');

    settings.defaultAgent.commands = oldCmds;
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  }, 15000);
});
