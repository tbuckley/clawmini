import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { getSocketPath } from '../../src/shared/workspace.js';
import { createE2EContext } from '../_helpers/utils.js';

const { runCli, e2eDir, binPath, setupE2E, teardownE2E } = createE2EContext('e2e-tmp-daemon');

describe('E2E Daemon and Web Tests', () => {
  beforeAll(async () => {
    await setupE2E();
    await runCli(['init']);
  }, 30000);

  afterAll(teardownE2E, 30000);

  it('should explicitly start the daemon via up command', async () => {
    const { stdout, code } = await runCli(['up']);
    expect(code).toBe(0);
    // Since the daemon is likely running from previous tests or init, it should say so
    // or it will start successfully.
    expect(stdout).toMatch(/(Daemon is already running\.|Successfully started clawmini daemon\.)/);
  });

  it('should successfully shut down the daemon', async () => {
    const { stdout, code } = await runCli(['down']);

    expect(code).toBe(0);
    expect(stdout).toContain('Successfully shut down clawmini daemon.');

    await new Promise((resolve) => setTimeout(resolve, 500));

    const socketPath = getSocketPath(e2eDir);
    expect(fs.existsSync(socketPath)).toBe(false);

    const { stdout: stdoutAgain, code: codeAgain } = await runCli(['down']);
    expect(codeAgain).toBe(0);
    expect(stdoutAgain).toContain('Daemon is not running.');

    const { stdout: stdoutUp, code: codeUp } = await runCli(['up']);
    expect(codeUp).toBe(0);
    expect(stdoutUp).toContain('Successfully started clawmini daemon.');
  }, 15000);

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
    expect(res404.status).toBe(200);
    const html404 = await res404.text();
    expect(html404.toLowerCase()).toContain('<!doctype html>');

    await runCli(['chats', 'add', 'api-test-chat']);

    const resChats = await fetch(`http://127.0.0.1:${webPort}/api/chats`);
    expect(resChats.status).toBe(200);
    const chats = (await resChats.json()) as string[];
    expect(chats).toContain('api-test-chat');

    const resPost = await fetch(`http://127.0.0.1:${webPort}/api/chats/api-test-chat/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'api test message' }),
    });
    expect(resPost.status).toBe(200);
    const postData = (await resPost.json()) as { success: boolean };
    expect(postData.success).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 500));

    const resHistory = await fetch(`http://127.0.0.1:${webPort}/api/chats/api-test-chat`);
    expect(resHistory.status).toBe(200);
    const history = (await resHistory.json()) as { id: string; role: string; content: string }[];
    expect(history.length).toBeGreaterThan(0);
    expect(history[0]?.role).toBe('user');
    expect(history[0]?.content).toBe('api test message');

    const resPost2 = await fetch(`http://127.0.0.1:${webPort}/api/chats/api-test-chat/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'second message' }),
    });
    expect(resPost2.status).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 500));

    const resHistory2 = await fetch(`http://127.0.0.1:${webPort}/api/chats/api-test-chat`);
    const history2 = (await resHistory2.json()) as { id: string; role: string; content: string }[];

    // Test API pagination
    if (history2.length > 1) {
      const lastMsg = history2[history2.length - 1];
      const paginatedRes = await fetch(
        `http://127.0.0.1:${webPort}/api/chats/api-test-chat?limit=1&before=${lastMsg?.id}`
      );
      const paginated = (await paginatedRes.json()) as {
        id: string;
        role: string;
        content: string;
      }[];
      expect(paginated.length).toBe(1);
    }

    const sseResponse = await fetch(`http://127.0.0.1:${webPort}/api/chats/api-test-chat/stream`);
    expect(sseResponse.status).toBe(200);
    expect(sseResponse.headers.get('content-type')).toContain('text/event-stream');

    if (!sseResponse.body) {
      throw new Error('SSE response body is null');
    }
    const reader = sseResponse.body.getReader();
    const decoder = new TextDecoder();

    const chatLogPath = path.resolve(e2eDir, '.clawmini/chats/api-test-chat/chat.jsonl');
    const mockMessage = {
      id: 'mock-1',
      role: 'user',
      content: 'sse test message',
      timestamp: new Date().toISOString(),
    };
    fs.appendFileSync(chatLogPath, JSON.stringify(mockMessage) + '\n');

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

    await reader.cancel();

    const resPostAgent = await fetch(`http://127.0.0.1:${webPort}/api/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'api-agent-1',
        directory: './api-agent-dir',
        env: { API_KEY: 'test-key' },
      }),
    });
    expect(resPostAgent.status).toBe(201);
    const postAgentData = (await resPostAgent.json()) as Record<string, unknown>;
    expect(postAgentData.id).toBe('api-agent-1');
    expect(postAgentData.directory).toBe('./api-agent-dir');
    expect((postAgentData.env as Record<string, string>).API_KEY).toBe('test-key');

    const resGetAgents = await fetch(`http://127.0.0.1:${webPort}/api/agents`);
    expect(resGetAgents.status).toBe(200);
    const agentsList = (await resGetAgents.json()) as Record<string, unknown>[];
    expect(agentsList.some((a) => a.id === 'api-agent-1')).toBe(true);

    const resGetAgent = await fetch(`http://127.0.0.1:${webPort}/api/agents/api-agent-1`);
    expect(resGetAgent.status).toBe(200);
    const getAgentData = (await resGetAgent.json()) as Record<string, unknown>;
    expect(getAgentData.id).toBe('api-agent-1');
    expect(getAgentData.directory).toBe('./api-agent-dir');

    const resPutAgent = await fetch(`http://127.0.0.1:${webPort}/api/agents/api-agent-1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ directory: './updated-dir' }),
    });
    expect(resPutAgent.status).toBe(200);
    const putAgentData = (await resPutAgent.json()) as Record<string, unknown>;
    expect(putAgentData.directory).toBe('./updated-dir');
    expect((putAgentData.env as Record<string, string>).API_KEY).toBe('test-key');

    const resDeleteAgent = await fetch(`http://127.0.0.1:${webPort}/api/agents/api-agent-1`, {
      method: 'DELETE',
    });
    expect(resDeleteAgent.status).toBe(200);

    const resGetAgentsAfterDelete = await fetch(`http://127.0.0.1:${webPort}/api/agents`);
    const agentsListAfterDelete = (await resGetAgentsAfterDelete.json()) as Record<
      string,
      unknown
    >[];
    expect(agentsListAfterDelete.some((a) => a.id === 'api-agent-1')).toBe(false);

    child.kill();
    await new Promise((resolve) => child.on('close', resolve));
  }, 30000);

  it('should optionally start an HTTP API server for the daemon when configured', async () => {
    await runCli(['down']);

    const settingsPath = path.resolve(e2eDir, '.clawmini/settings.json');
    let originalSettings = '{}';
    if (fs.existsSync(settingsPath)) {
      originalSettings = fs.readFileSync(settingsPath, 'utf8');
    }

    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        ...JSON.parse(originalSettings),
        api: { host: '127.0.0.1', port: 3005 },
      })
    );

    const { stdout, code } = await runCli(['up']);
    expect(code).toBe(0);
    expect(stdout).toContain('Successfully started clawmini daemon.');

    await new Promise((resolve) => setTimeout(resolve, 500));

    const res = await fetch('http://127.0.0.1:3005/ping');
    expect(res.status).toBe(200);
    const data = (await res.json()) as { result: { data: { status: string } } };
    expect(data.result.data.status).toBe('ok');

    await runCli(['down']);
    fs.writeFileSync(settingsPath, originalSettings);
    await runCli(['up']);
  }, 15000);

  it('should inject CLAW_API_URL and CLAW_API_TOKEN into spawned agents when API is enabled', async () => {
    await runCli(['down']);
    const settingsPath = path.resolve(e2eDir, '.clawmini/settings.json');
    let originalSettings = '{}';
    if (fs.existsSync(settingsPath)) {
      originalSettings = fs.readFileSync(settingsPath, 'utf8');
    }
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        ...JSON.parse(originalSettings),
        api: { host: '127.0.0.1', port: 3006 },
      })
    );
    await runCli(['up']);

    await runCli(['agents', 'add', 'env-dumper', '--dir', 'env-dumper']);
    const envDumperSettingsPath = path.resolve(e2eDir, '.clawmini/agents/env-dumper/settings.json');
    fs.mkdirSync(path.dirname(envDumperSettingsPath), { recursive: true });

    // Create the actual agent working directory so spawn doesn't fail with ENOENT
    const agentWorkingDir = path.resolve(e2eDir, 'env-dumper');
    fs.mkdirSync(agentWorkingDir, { recursive: true });

    fs.writeFileSync(
      envDumperSettingsPath,
      JSON.stringify({
        commands: {
          new: process.platform === 'win32' ? 'set' : 'env',
        },
      })
    );

    await runCli(['chats', 'add', 'env-chat']);
    const { stdout, stderr, code } = await runCli([
      'messages',
      'send',
      'dump it',
      '--chat',
      'env-chat',
      '--agent',
      'env-dumper',
    ]);
    if (code !== 0) {
      console.error('send failed:', stdout, stderr);
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));

    const chatLogPath = path.resolve(e2eDir, '.clawmini/chats/env-chat/chat.jsonl');
    expect(fs.existsSync(chatLogPath)).toBe(true);
    const chatLogContent = fs.readFileSync(chatLogPath, 'utf8');

    if (!chatLogContent.includes('CLAW_API_URL')) {
      console.error('CHAT LOG:', chatLogContent);
    }

    expect(chatLogContent).toContain('CLAW_API_URL=http://127.0.0.1:3006');
    expect(chatLogContent).toContain('CLAW_API_TOKEN=');

    await runCli(['down']);
    fs.writeFileSync(settingsPath, originalSettings);
    await runCli(['up']);
  }, 15000);

});
