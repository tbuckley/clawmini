import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import type { ChatMessage } from '../shared/chats.js';

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
  }, 30000);

  afterAll(async () => {
    // Kill the daemon after all tests
    const pkill = spawn('pkill', ['-f', 'dist/daemon/index.mjs']);
    await new Promise((resolve) => pkill.on('close', resolve));

    // Cleanup e2e temporary directory
    if (fs.existsSync(e2eDir)) {
      fs.rmSync(e2eDir, { recursive: true, force: true });
    }
  }, 30000);

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

  it('should create, list, update and delete agents', async () => {
    // Add an agent
    const { stdout: stdoutAdd, code: codeAdd } = await runCli([
      'agents',
      'add',
      'test-agent',
      '--directory',
      './test-agent-dir',
      '--env',
      'FOO=BAR',
      '--env',
      'BAZ=QUX',
    ]);
    expect(codeAdd).toBe(0);
    expect(stdoutAdd).toContain('Agent test-agent created successfully.');

    // Verify settings were created correctly
    const agentSettingsPath = path.resolve(e2eDir, '.clawmini/agents/test-agent/settings.json');
    expect(fs.existsSync(agentSettingsPath)).toBe(true);
    const agentData = JSON.parse(fs.readFileSync(agentSettingsPath, 'utf8'));
    expect(agentData.directory).toBe('./test-agent-dir');
    expect(agentData.env?.FOO).toBe('BAR');
    expect(agentData.env?.BAZ).toBe('QUX');

    // List agents
    const { stdout: stdoutList1 } = await runCli(['agents', 'list']);
    expect(stdoutList1).toContain('- test-agent');

    // Update agent
    const { stdout: stdoutUpdate, code: codeUpdate } = await runCli([
      'agents',
      'update',
      'test-agent',
      '--directory',
      './new-dir',
      '--env',
      'FOO=NEW_BAR',
    ]);
    expect(codeUpdate).toBe(0);
    expect(stdoutUpdate).toContain('Agent test-agent updated successfully.');

    // Verify update
    const updatedAgentData = JSON.parse(fs.readFileSync(agentSettingsPath, 'utf8'));
    expect(updatedAgentData.directory).toBe('./new-dir');
    expect(updatedAgentData.env?.FOO).toBe('NEW_BAR');
    expect(updatedAgentData.env?.BAZ).toBe('QUX'); // Should merge, keeping old env keys not overwritten

    // Delete agent
    const { stdout: stdoutDelete, code: codeDelete } = await runCli([
      'agents',
      'delete',
      'test-agent',
    ]);
    expect(codeDelete).toBe(0);
    expect(stdoutDelete).toContain('Agent test-agent deleted successfully.');
    expect(fs.existsSync(agentSettingsPath)).toBe(false);
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

    // Check if the setting was persisted
    const chatSettingsPath = path.resolve(e2eDir, '.clawmini/chats/agent-chat/settings.json');
    expect(fs.existsSync(chatSettingsPath)).toBe(true);
    const chatSettings = JSON.parse(fs.readFileSync(chatSettingsPath, 'utf8'));
    expect(chatSettings.defaultAgent).toBe('custom-agent');

    // Test that using an invalid agent fails
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

    const chatSettingsPath = path.resolve(e2eDir, '.clawmini/chats/workflow-chat/settings.json');
    const chatSettings = JSON.parse(fs.readFileSync(chatSettingsPath, 'utf8'));
    expect(chatSettings.sessions?.default).toBe('session-123');

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
  });

  it('should explicitly start the daemon via up command', async () => {
    const { stdout, code } = await runCli(['up']);
    expect(code).toBe(0);
    // Since the daemon is likely running from previous tests, it should say so
    expect(stdout).toContain('Daemon is already running.');
  });

  it('should successfully shut down the daemon', async () => {
    const { stdout, code } = await runCli(['down']);

    expect(code).toBe(0);
    expect(stdout).toContain('Successfully shut down clawmini daemon.');

    // Wait a brief moment for the daemon to fully shut down and clean up
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Verify socket is gone
    const socketPath = path.resolve(e2eDir, '.clawmini/daemon.sock');
    expect(fs.existsSync(socketPath)).toBe(false);

    // Running down again should say it's not running
    const { stdout: stdoutAgain, code: codeAgain } = await runCli(['down']);
    expect(codeAgain).toBe(0);
    expect(stdoutAgain).toContain('Daemon is not running.');

    // Running up after it's been killed should start it
    const { stdout: stdoutUp, code: codeUp } = await runCli(['up']);
    expect(codeUp).toBe(0);
    expect(stdoutUp).toContain('Successfully started clawmini daemon.');
  });

  it('should run web command and serve static files', async () => {
    const webPort = 8081;
    const child = spawn('node', [binPath, 'web', '--port', webPort.toString()], {
      cwd: e2eDir,
      env: { ...process.env },
    });

    let output = '';
    child.stdout.on('data', (d) => {
      output += d.toString();
    });
    child.stderr.on('data', (d) => {
      output += d.toString();
    });

    // Wait for the server to start
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        clearInterval(check);
        reject(new Error('Timeout waiting for web server: ' + output));
      }, 5000);
      const check = setInterval(() => {
        if (output.includes('Clawmini web interface running')) {
          clearInterval(check);
          clearTimeout(timeout);
          resolve();
        }
      }, 100);
    });

    const res = await fetch(`http://127.0.0.1:${webPort}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html.toLowerCase()).toContain('<!doctype html>');
    expect(html).toContain('<html');

    const res404 = await fetch(`http://127.0.0.1:${webPort}/some-non-existent-route`);
    expect(res404.status).toBe(200); // SPA fallback returns index.html (200 OK)
    const html404 = await res404.text();
    expect(html404.toLowerCase()).toContain('<!doctype html>');

    // Create a chat for API testing
    await runCli(['chats', 'add', 'api-test-chat']);

    // Test GET /api/chats
    const resChats = await fetch(`http://127.0.0.1:${webPort}/api/chats`);
    expect(resChats.status).toBe(200);
    const chats = (await resChats.json()) as string[];
    expect(chats).toContain('api-test-chat');

    // Test POST /api/chats/:id/messages
    const resPost = await fetch(`http://127.0.0.1:${webPort}/api/chats/api-test-chat/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'api test message' }),
    });
    expect(resPost.status).toBe(200);
    const postData = (await resPost.json()) as { success: boolean };
    expect(postData.success).toBe(true);

    // Give daemon time to process
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Test GET /api/chats/:id
    const resHistory = await fetch(`http://127.0.0.1:${webPort}/api/chats/api-test-chat`);
    expect(resHistory.status).toBe(200);
    const history = (await resHistory.json()) as ChatMessage[];
    expect(history.length).toBeGreaterThan(0);
    expect(history[0]?.role).toBe('user');
    expect(history[0]?.content).toBe('api test message');

    // Test SSE endpoint GET /api/chats/:id/stream
    const sseResponse = await fetch(`http://127.0.0.1:${webPort}/api/chats/api-test-chat/stream`);
    expect(sseResponse.status).toBe(200);
    expect(sseResponse.headers.get('content-type')).toContain('text/event-stream');

    // Listen for SSE events
    if (!sseResponse.body) {
      throw new Error('SSE response body is null');
    }
    const reader = sseResponse.body.getReader();
    const decoder = new TextDecoder();

    // Simulate daemon appending a message
    const chatLogPath = path.resolve(e2eDir, '.clawmini/chats/api-test-chat/chat.jsonl');
    const mockMessage = {
      id: 'mock-1',
      role: 'user',
      content: 'sse test message',
      timestamp: new Date().toISOString(),
    };
    fs.appendFileSync(chatLogPath, JSON.stringify(mockMessage) + '\n');

    // Read the stream to verify the event
    let sseData = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      sseData += decoder.decode(value, { stream: true });
      if (sseData.includes('sse test message')) {
        break;
      }
    }

    expect(sseData).toContain('data: {"id":"mock-1","role":"user","content":"sse test message"');

    // Close the connection
    await reader.cancel();

    child.kill();
    await new Promise((resolve) => child.on('close', resolve));
  });
});
