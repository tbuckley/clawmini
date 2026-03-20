import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { createE2EContext } from './utils.js';

const { runCli, e2eDir, setupE2E, teardownE2E } = createE2EContext('e2e-subagents-lite');

describe('E2E Subagents Lite Tests', () => {
  beforeAll(async () => {
    await setupE2E();
    await runCli(['init']);
  }, 30000);

  afterAll(teardownE2E, 30000);

  it('should run exported clawmini-lite script to test subagents functionality', async () => {
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
        api: { host: '127.0.0.1', port: 59345 },
      })
    );
    const upRes = await runCli(['up']);
    if (upRes.code !== 0) {
      console.error('up failed', upRes.stderr);
    }

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
    const dumpRes = await runCli([
      'messages',
      'send',
      'dump',
      '--chat',
      'lite-chat',
      '--agent',
      'lite-env-dumper',
    ]);
    if (dumpRes.code !== 0) {
      console.error('dump failed', dumpRes.stderr);
    }

    await new Promise((resolve) => setTimeout(resolve, 3000));

    const envTxtPath = path.resolve(envDumperAgentDir, 'env.txt');
    if (!fs.existsSync(envTxtPath)) {
      console.error(
        'daemon log:',
        fs.readFileSync(path.resolve(e2eDir, '.clawmini/daemon.log'), 'utf8')
      );
    }
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
    console.log('ENV URL:', envUrl);

    // 1. Test subagents add
    const addProcess = spawn('node', [litePath, 'subagents', 'add', 'hello subagent'], {
      env: { ...process.env, CLAW_API_URL: envUrl, CLAW_API_TOKEN: envToken },
    });
    let addStdout = '';
    let addStderr = '';
    addProcess.stdout.on('data', (d) => (addStdout += d.toString()));
    addProcess.stderr.on('data', (d) => (addStderr += d.toString()));
    await new Promise((resolve) => addProcess.on('close', resolve));
    if (!addStdout.includes('Subagent created')) {
      console.error('addStdout:', addStdout);
      console.error('addStderr:', addStderr);
      console.error(
        'daemon log:',
        fs.readFileSync(path.resolve(e2eDir, '.clawmini/daemon.log'), 'utf8')
      );
    }
    expect(addStdout).toContain('Subagent created with ID: ');

    // Extract subagent ID
    const match = addStdout.match(/ID: ([a-f0-9-]+)/);
    expect(match).toBeTruthy();
    const subagentId = match![1]!;

    // 2. Test subagents list
    const listProcess = spawn('node', [litePath, 'subagents', 'list'], {
      env: { ...process.env, CLAW_API_URL: envUrl, CLAW_API_TOKEN: envToken },
    });
    let listStdout = '';
    listProcess.stdout.on('data', (d) => (listStdout += d.toString()));
    listProcess.stderr.on('data', (d) => (listStdout += d.toString()));
    await new Promise((resolve) => listProcess.on('close', resolve));
    expect(listStdout).toContain(subagentId);

    // 3. Test subagents send
    const sendProcess = spawn('node', [litePath, 'subagents', 'send', subagentId, 'next message'], {
      env: { ...process.env, CLAW_API_URL: envUrl, CLAW_API_TOKEN: envToken },
    });
    let sendStdout = '';
    sendProcess.stdout.on('data', (d) => (sendStdout += d.toString()));
    sendProcess.stderr.on('data', (d) => (sendStdout += d.toString()));
    await new Promise((resolve) => sendProcess.on('close', resolve));
    expect(sendStdout).toContain('Message sent.');

    // Give it a moment to process the message
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // 4. Test subagents tail
    const tailProcess = spawn('node', [litePath, 'subagents', 'tail', subagentId], {
      env: { ...process.env, CLAW_API_URL: envUrl, CLAW_API_TOKEN: envToken },
    });
    let tailStdout = '';
    tailProcess.stdout.on('data', (d) => (tailStdout += d.toString()));
    tailProcess.stderr.on('data', (d) => (tailStdout += d.toString()));
    await new Promise((resolve) => tailProcess.on('close', resolve));
    expect(tailStdout).toContain('hello subagent');
    expect(tailStdout).toContain('next message');

    // 5. Test subagents stop
    const stopProcess = spawn('node', [litePath, 'subagents', 'stop', subagentId], {
      env: { ...process.env, CLAW_API_URL: envUrl, CLAW_API_TOKEN: envToken },
    });
    let stopStdout = '';
    stopProcess.stdout.on('data', (d) => (stopStdout += d.toString()));
    stopProcess.stderr.on('data', (d) => (stopStdout += d.toString()));
    await new Promise((resolve) => stopProcess.on('close', resolve));
    expect(stopStdout).toContain('Subagent stopped.');

    // 6. Test subagents delete
    const delProcess = spawn('node', [litePath, 'subagents', 'delete', subagentId], {
      env: { ...process.env, CLAW_API_URL: envUrl, CLAW_API_TOKEN: envToken },
    });
    let delStdout = '';
    delProcess.stdout.on('data', (d) => (delStdout += d.toString()));
    delProcess.stderr.on('data', (d) => (delStdout += d.toString()));
    await new Promise((resolve) => delProcess.on('close', resolve));
    expect(delStdout).toContain('Subagent deleted.');

    // 7. Verify deletion via list
    const listProcess2 = spawn('node', [litePath, 'subagents', 'list', '-c', 'lite-chat'], {
      env: { ...process.env, CLAW_API_URL: envUrl, CLAW_API_TOKEN: envToken },
    });
    let listStdout2 = '';
    listProcess2.stdout.on('data', (d) => (listStdout2 += d.toString()));
    listProcess2.stderr.on('data', (d) => (listStdout2 += d.toString()));
    await new Promise((resolve) => listProcess2.on('close', resolve));
    expect(listStdout2).not.toContain(subagentId);

    await runCli(['down']);
    fs.writeFileSync(settingsPath, originalSettings);
    await runCli(['up']);
  }, 45000);
});
