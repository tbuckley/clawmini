import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const binPath = path.resolve(__dirname, '../../dist/cli/index.mjs');
const e2eDir = path.resolve(__dirname, '../../e2e-tmp');

function runCli(args: string[]): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    const child = spawn('node', [binPath, ...args], {
      cwd: e2eDir,
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      resolve({ stdout, stderr, code });
    });
  });
}

describe('E2E CLI Tests', () => {
  beforeAll(async () => {
    // Ensure build is fresh before running tests
    const build = spawn('npm', ['run', 'build']);
    await new Promise((resolve) => build.on('close', resolve));

    // Setup fresh e2e temporary directory
    if (fs.existsSync(e2eDir)) {
      fs.rmSync(e2eDir, { recursive: true, force: true });
    }
    fs.mkdirSync(e2eDir, { recursive: true });
  });

  afterAll(async () => {
    // Kill the daemon after all tests
    const pkill = spawn('pkill', ['-f', 'dist/daemon/index.mjs']);
    await new Promise((resolve) => pkill.on('close', resolve));

    // Cleanup e2e temporary directory
    if (fs.existsSync(e2eDir)) {
      fs.rmSync(e2eDir, { recursive: true, force: true });
    }
  });

  it('should run init and initialize settings', async () => {
    const { stdout, code } = await runCli(['init']);

    expect(code).toBe(0);
    expect(stdout).toContain('Initialized .clawmini/settings.json');

    const clawminiDir = path.resolve(e2eDir, '.clawmini');
    expect(fs.existsSync(path.join(clawminiDir, 'settings.json'))).toBe(true);
  });

  it('should create, list, set-default and delete chats', async () => {
    const { stdout: stdoutAdd, code: codeAdd } = await runCli(['chats', 'add', 'test-chat']);
    expect(codeAdd).toBe(0);
    expect(stdoutAdd).toContain('Chat test-chat created successfully.');

    const chatsDir = path.resolve(e2eDir, '.clawmini/chats');
    expect(fs.existsSync(path.join(chatsDir, 'test-chat', 'chat.jsonl'))).toBe(true);

    const { stdout: stdoutList1 } = await runCli(['chats', 'list']);
    expect(stdoutList1).toContain('- test-chat');

    const { stdout: stdoutSetDefault } = await runCli(['chats', 'set-default', 'test-chat']);
    expect(stdoutSetDefault).toContain('Default chat set to test-chat.');

    const { stdout: stdoutList2 } = await runCli(['chats', 'list']);
    expect(stdoutList2).toContain('- test-chat *');

    const { stdout: stdoutDelete } = await runCli(['chats', 'delete', 'test-chat']);
    expect(stdoutDelete).toContain('Chat test-chat deleted successfully.');
    expect(fs.existsSync(path.join(chatsDir, 'test-chat'))).toBe(false);
  });

  it('should send a message via the daemon', async () => {
    const { stdout, code } = await runCli(['messages', 'send', 'e2e test message']);

    expect(code).toBe(0);
    expect(stdout).toContain('Message sent successfully.');

    // Check if the daemon log reflects the execution
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

    // Give daemon time to process
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

    // Give daemon time to process
    await new Promise((resolve) => setTimeout(resolve, 500));

    const chatLog = fs.readFileSync(
      path.resolve(e2eDir, '.clawmini/chats/session-chat/chat.jsonl'),
      'utf8'
    );
    expect(chatLog).toContain('session test message');
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

    // Give daemon time to process
    await new Promise((resolve) => setTimeout(resolve, 500));

    const chatLog = fs.readFileSync(
      path.resolve(e2eDir, '.clawmini/chats/nowait-chat/chat.jsonl'),
      'utf8'
    );
    expect(chatLog).toContain('no wait message');
  });

  it('should maintain atomic ordering of user and log messages with --no-wait', async () => {
    // Override settings to simulate a slow command
    const settingsPath = path.resolve(e2eDir, '.clawmini/settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const oldCmd = settings.defaultAgent?.commands?.new;

    settings.defaultAgent = settings.defaultAgent || {};
    settings.defaultAgent.commands = settings.defaultAgent.commands || {};
    settings.defaultAgent.commands.new = 'sleep 0.2 && echo $CLAW_CLI_MESSAGE';
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

    await runCli(['chats', 'add', 'order-chat']);

    // Send two messages consecutively
    await runCli(['messages', 'send', 'first', '--chat', 'order-chat', '--no-wait']);
    await runCli(['messages', 'send', 'second', '--chat', 'order-chat', '--no-wait']);

    // Give daemon time to process both
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Restore settings
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
    expect(lines[1].role).toBe('log');
    expect(lines[1].content.trim()).toBe('first');
    expect(lines[2].role).toBe('user');
    expect(lines[2].content).toBe('second');
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
    let lines = chatLog.trim().split('\n').map((l) => JSON.parse(l));

    expect(lines).toHaveLength(2);
    expect(lines[1].command).toBe('echo "NEW $CLAW_CLI_MESSAGE" && echo "ERR NEW" >&2');
    expect(lines[1].content).toContain('EXTRACTED-NEW msg-1');
    expect(lines[1].stderr).toContain('ERR NEW');
    expect(lines[1].stdout).toContain('NEW msg-1');

    const chatSettingsPath = path.resolve(e2eDir, '.clawmini/chats/workflow-chat/settings.json');
    const chatSettings = JSON.parse(fs.readFileSync(chatSettingsPath, 'utf8'));
    expect(chatSettings.sessions?.default).toBe('session-123');

    await runCli(['messages', 'send', 'msg-2', '--chat', 'workflow-chat']);
    await new Promise((resolve) => setTimeout(resolve, 800));

    chatLog = fs.readFileSync(chatLogPath, 'utf8');
    lines = chatLog.trim().split('\n').map((l) => JSON.parse(l));

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
    lines = chatLog.trim().split('\n').map((l) => JSON.parse(l));

    expect(lines).toHaveLength(6);
    expect(lines[5].stdout).toBeUndefined();
    expect(lines[5].stderr).toContain('ERR APPEND');
    expect(lines[5].stderr).toContain('getMessageContent failed: EXTRACTION_FAIL');

    settings.defaultAgent.commands = oldCmds;
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  });
});
