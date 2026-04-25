import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import { TestEnvironment } from '../_helpers/test-environment.js';

async function waitUntil(
  cond: () => boolean,
  timeoutMs: number,
  intervalMs = 100
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return cond();
}

describe('clawmini serve (detached) + down', () => {
  let env: TestEnvironment;

  beforeAll(async () => {
    env = new TestEnvironment('e2e-tmp-serve');
    await env.setup();
    await env.init();
  }, 30000);

  afterAll(() => env.teardown(), 30000);

  it('starts the supervisor in the background and writes a pid file', async () => {
    const { code, stdout } = await env.runCli(['serve', '--detach']);
    expect(code).toBe(0);
    expect(stdout).toContain('Started clawmini supervisor in background');

    const pidPath = env.getClawminiPath('supervisor.pid');
    expect(await waitUntil(() => fs.existsSync(pidPath), 5000)).toBe(true);

    const socketPath = env.getClawminiPath('daemon.sock');
    expect(await waitUntil(() => fs.existsSync(socketPath), 10000)).toBe(true);
  }, 30000);

  it('refuses to start a second supervisor while one is running', async () => {
    const { code, stderr } = await env.runCli(['serve', '--detach']);
    expect(code).toBe(1);
    expect(stderr).toContain('already running');
  }, 15000);

  it('clawmini down stops the supervisor and clears the socket + pid file', async () => {
    const { code } = await env.runCli(['down']);
    expect(code).toBe(0);

    const pidPath = env.getClawminiPath('supervisor.pid');
    const socketPath = env.getClawminiPath('daemon.sock');
    expect(await waitUntil(() => !fs.existsSync(pidPath), 10000)).toBe(true);
    expect(await waitUntil(() => !fs.existsSync(socketPath), 10000)).toBe(true);
  }, 30000);

  it('writes daemon output to .clawmini/logs/daemon.log', () => {
    const logPath = env.getClawminiPath('logs', 'daemon.log');
    expect(fs.existsSync(logPath)).toBe(true);
    const content = fs.readFileSync(logPath, 'utf-8');
    expect(content).toContain('Daemon initialized and listening');
  });

  it('clawmini logs --service daemon prints prefixed output', async () => {
    const { code, stdout } = await env.runCli(['logs', '--service', 'daemon']);
    expect(code).toBe(0);
    expect(stdout).toContain('[daemon]');
    expect(stdout).toContain('Daemon initialized and listening');
  });

  it('clawmini down is a no-op when nothing is running', async () => {
    const { stdout, code } = await env.runCli(['down']);
    expect(code).toBe(0);
    expect(stdout).toContain('Daemon is not running');
  });
});
