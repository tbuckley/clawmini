import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { createE2EContext } from './utils.js';

const { runCli, e2eDir, setupE2E, teardownE2E } = createE2EContext('e2e-exp-lite');

describe('E2E Export Lite Functionality Tests', () => {
  beforeAll(async () => {
    await setupE2E();
    await runCli(['init']);
  }, 30000);

  afterAll(teardownE2E, 30000);

  it('should run exported clawmini-lite script and verify its functionality', async () => {
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
        api: { host: '127.0.0.1', port: 3007 },
      })
    );
    await runCli(['up']);

    // Export lite script
    const litePath = path.resolve(e2eDir, 'clawmini-lite.js');
    await runCli(['export-lite', '--out', litePath]);
    expect(fs.existsSync(litePath)).toBe(true);

    const envDumperAgentDir = path.resolve(e2eDir, 'lite-env-dumper');
    fs.mkdirSync(envDumperAgentDir, { recursive: true });
    await runCli(['agents', 'add', 'lite-env-dumper', '--dir', 'lite-env-dumper']);

    const dumperSettings = path.resolve(e2eDir, '.clawmini/agents/lite-env-dumper/settings.json');
    fs.mkdirSync(path.dirname(dumperSettings), { recursive: true });

    const dumperScript = process.platform === 'win32' ? 'set > env.txt' : 'env > env.txt';
    fs.writeFileSync(dumperSettings, JSON.stringify({ commands: { new: dumperScript } }));

    await runCli(['chats', 'add', 'lite-chat']);
    await runCli(['messages', 'send', 'dump', '--chat', 'lite-chat', '--agent', 'lite-env-dumper']);

    await new Promise((resolve) => setTimeout(resolve, 2000));

    const envTxtPath = path.resolve(envDumperAgentDir, 'env.txt');
    expect(fs.existsSync(envTxtPath)).toBe(true);
    const envContent = fs.readFileSync(envTxtPath, 'utf8');

    const urlMatch = envContent.match(/CLAW_API_URL=(.+)/);
    const tokenMatch = envContent.match(/CLAW_API_TOKEN=(.+)/);

    expect(urlMatch).toBeTruthy();
    expect(tokenMatch).toBeTruthy();

    if (!urlMatch || !tokenMatch) {
      throw new Error('Could not find API credentials');
    }

    const envUrl = urlMatch[1]!.trim();
    const envToken = tokenMatch[1]!.trim();
    const chatLogPath = path.resolve(e2eDir, '.clawmini/chats/lite-chat/chat.jsonl');

    // 1. Test reply with file
    const replyFileProcess = spawn(
      'node',
      [litePath, 'reply', 'hello with file', '--file', 'env.txt'],
      {
        env: { ...process.env, CLAW_API_URL: envUrl, CLAW_API_TOKEN: envToken },
        cwd: envDumperAgentDir,
      }
    );

    let replyFileStdout = '';
    replyFileProcess.stdout.on('data', (d) => (replyFileStdout += d.toString()));
    replyFileProcess.stderr.on('data', (d) => (replyFileStdout += d.toString()));
    await new Promise((resolve) => replyFileProcess.on('close', resolve));
    expect(replyFileStdout).toContain('Reply message appended');

    const chatLogContentUpdated = fs.readFileSync(chatLogPath, 'utf8');
    expect(chatLogContentUpdated).toContain('hello with file');
    expect(chatLogContentUpdated).toContain('"files":["lite-env-dumper/env.txt"]');

    // 1.6 Test reply
    const replyProcess = spawn('node', [litePath, 'reply', 'hello reply'], {
      env: { ...process.env, CLAW_API_URL: envUrl, CLAW_API_TOKEN: envToken },
    });
    let replyStdout = '';
    replyProcess.stdout.on('data', (d) => (replyStdout += d.toString()));
    replyProcess.stderr.on('data', (d) => (replyStdout += d.toString()));
    await new Promise((resolve) => replyProcess.on('close', resolve));
    expect(replyStdout).toContain('Reply message appended');

    const chatLogContentReply = fs.readFileSync(chatLogPath, 'utf8');
    expect(chatLogContentReply).toContain('hello reply');
    expect(chatLogContentReply).toContain('"role":"agent"');

    // 1.7 Test tool
    const toolProcess = spawn(
      'node',
      [litePath, 'tool', 'mytool', JSON.stringify({ key: 'value' })],
      {
        env: { ...process.env, CLAW_API_URL: envUrl, CLAW_API_TOKEN: envToken },
      }
    );
    let toolStdout = '';
    toolProcess.stdout.on('data', (d) => (toolStdout += d.toString()));
    toolProcess.stderr.on('data', (d) => (toolStdout += d.toString()));
    await new Promise((resolve) => toolProcess.on('close', resolve));
    expect(toolStdout).toContain('Tool message appended');

    const chatLogContentTool = fs.readFileSync(chatLogPath, 'utf8');
    expect(chatLogContentTool).toContain('"name":"mytool"');
    expect(chatLogContentTool).toContain('"role":"tool"');
    expect(chatLogContentTool).toContain('"payload":{"key":"value"}');

    // 2. Test jobs add
    const addProcess = spawn(
      'node',
      [litePath, 'jobs', 'add', 'lite-job', '--cron', '* * * * *', '--message', 'lite message'],
      {
        env: { ...process.env, CLAW_API_URL: envUrl, CLAW_API_TOKEN: envToken },
      }
    );
    let addStdout = '';
    addProcess.stdout.on('data', (d) => (addStdout += d.toString()));
    addProcess.stderr.on('data', (d) => (addStdout += d.toString()));
    await new Promise((resolve) => addProcess.on('close', resolve));
    expect(addStdout).toContain("Job 'lite-job' created successfully.");

    // 3. Test jobs list
    const listProcess = spawn('node', [litePath, 'jobs', 'list'], {
      env: { ...process.env, CLAW_API_URL: envUrl, CLAW_API_TOKEN: envToken },
    });
    let listStdout = '';
    listProcess.stdout.on('data', (d) => (listStdout += d.toString()));
    listProcess.stderr.on('data', (d) => (listStdout += d.toString()));
    await new Promise((resolve) => listProcess.on('close', resolve));
    expect(listStdout).toContain('lite-job');
    expect(listStdout).toContain('* * * * *');

    // 4. Test jobs delete
    const delProcess = spawn('node', [litePath, 'jobs', 'delete', 'lite-job'], {
      env: { ...process.env, CLAW_API_URL: envUrl, CLAW_API_TOKEN: envToken },
    });
    let delStdout = '';
    delProcess.stdout.on('data', (d) => (delStdout += d.toString()));
    delProcess.stderr.on('data', (d) => (delStdout += d.toString()));
    await new Promise((resolve) => delProcess.on('close', resolve));
    expect(delStdout).toContain("Job 'lite-job' deleted successfully.");

    // 5. Test fetch-pending
    const sleepCommand =
      process.platform === 'win32' ? 'node -e "setTimeout(() => {}, 5000)"' : 'sleep 5';
    fs.writeFileSync(dumperSettings, JSON.stringify({ commands: { new: sleepCommand } }));

    await runCli(['chats', 'add', 'sleep-chat']);
    // Start the agent to block the queue
    await runCli([
      'messages',
      'send',
      'block queue',
      '--chat',
      'sleep-chat',
      '--agent',
      'lite-env-dumper',
      '--no-wait',
    ]);

    // Send a pending message that will be queued
    await runCli([
      'messages',
      'send',
      'my pending message',
      '--chat',
      'sleep-chat',
      '--agent',
      'lite-env-dumper',
      '--no-wait',
    ]);

    // Fetch the pending message
    const fetchProcess = spawn('node', [litePath, 'fetch-pending'], {
      env: { ...process.env, CLAW_API_URL: envUrl, CLAW_API_TOKEN: envToken },
    });
    let fetchStdout = '';
    fetchProcess.stdout.on('data', (d) => (fetchStdout += d.toString()));
    fetchProcess.stderr.on('data', (d) => (fetchStdout += d.toString()));
    await new Promise((resolve) => fetchProcess.on('close', resolve));

    expect(fetchStdout).toContain('<message>');
    expect(fetchStdout).toContain('my pending message');
    expect(fetchStdout).toContain('</message>');

    await runCli(['down']);
    fs.writeFileSync(settingsPath, originalSettings);
    await runCli(['up']);
  }, 30000);
});
