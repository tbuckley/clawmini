import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { TestEnvironment } from '../_helpers/test-environment.js';

describe('Environments E2E', () => {
  let env: TestEnvironment;

  beforeAll(async () => {
    env = new TestEnvironment('e2e-env');
    await env.setup();
    await env.init();
  }, 30000);

  afterAll(() => env.teardown(), 30000);

  it('should run environment up and down commands on daemon start and stop', async () => {
    // Create an environment with up and down commands
    const envDir = path.join(env.e2eDir, '.clawmini', 'environments', 'test-env');
    fs.mkdirSync(envDir, { recursive: true });

    const upHookPath = path.join(env.e2eDir, 'up-hook-run.txt');
    const downHookPath = path.join(env.e2eDir, 'down-hook-run.txt');

    fs.writeFileSync(
      path.join(envDir, 'env.json'),
      JSON.stringify({
        up: `echo "env-up" > ${JSON.stringify(upHookPath)}`,
        down: `echo "env-down" > ${JSON.stringify(downHookPath)}`,
      })
    );

    // Enable the environment
    await env.runCli(['environments', 'enable', 'test-env']);

    // Start the daemon (should trigger up hook)
    const { stdout: upStdout, code: upCode } = await env.runCli(['up']);
    expect(upCode).toBe(0);
    expect(upStdout).toMatch(
      /(Daemon is already running\.|Successfully started clawmini daemon\.)/
    );

    // Wait for up hook to complete (daemon start might be slightly async in executing hooks)
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // The daemon might have already been running since beforeAll init might start it.
    // So let's actually shut it down, then start it to be sure.
    await env.runCli(['down']);
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Clear out files if they exist
    if (fs.existsSync(upHookPath)) fs.unlinkSync(upHookPath);
    if (fs.existsSync(downHookPath)) fs.unlinkSync(downHookPath);

    // Start daemon
    await env.runCli(['up']);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(fs.existsSync(upHookPath)).toBe(true);
    expect(fs.readFileSync(upHookPath, 'utf8').trim()).toBe('env-up');

    // Stop daemon
    await env.runCli(['down']);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(fs.existsSync(downHookPath)).toBe(true);
    expect(fs.readFileSync(downHookPath, 'utf8').trim()).toBe('env-down');
  }, 30000);
});
