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

  it('should send a message via the daemon', async () => {
    const { stdout, code } = await runCli(['messages', 'send', 'e2e test message']);

    expect(code).toBe(0);
    expect(stdout).toContain('Message sent successfully.');

    // Check if the daemon log reflects the execution
    const daemonLog = fs.readFileSync(path.resolve(e2eDir, '.clawmini/daemon.log'), 'utf8');
    expect(daemonLog).toContain('e2e test message');
  });
});
