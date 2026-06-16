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

  it('`environments check` runs the standard suite and surfaces FAILs for an un-isolated env', async () => {
    // No-op env: command runs directly under sh with no sandboxing, no proxy,
    // no PATH augmentation. Every restriction-oriented check should FAIL.
    const envDir = path.join(env.e2eDir, '.clawmini', 'environments', 'pass-through');
    fs.mkdirSync(envDir, { recursive: true });
    fs.writeFileSync(
      path.join(envDir, 'env.json'),
      JSON.stringify({ prefix: "sh -c '{COMMAND}'" })
    );

    const { stdout, code } = await env.runCli(['environments', 'check', 'pass-through']);
    expect(code).toBe(1);

    // Baseline functional check: writing to the workspace still works.
    expect(stdout).toMatch(/\[PASS\] workspace is writable/);

    // Restriction checks: all should FAIL against a no-op env.
    expect(stdout).toMatch(/\[FAIL\] \.clawmini directory is hidden from the sandbox/);
    expect(stdout).toMatch(/\[FAIL\] HTTP_PROXY env var is set/);
    expect(stdout).toMatch(/\[FAIL\] clawmini-lite\.js is on PATH/);
    expect(stdout).toMatch(/\[FAIL\] non-allowlisted domain is blocked by the proxy/);
    expect(stdout).toMatch(/\[FAIL\] writes outside approved paths do not escape to the host/);

    // Summary line shape.
    expect(stdout).toMatch(/\d+ passed, \d+ failed \(6 total\)/);
  }, 60000);

  it('`environments check` surfaces per-check PASS when the env satisfies it', async () => {
    const envDir = path.join(env.e2eDir, '.clawmini', 'environments', 'proxy-env-only');
    fs.mkdirSync(envDir, { recursive: true });
    // Env supplies HTTP_PROXY but does no actual sandboxing — demonstrates
    // that the check suite reports partial wins, not all-or-nothing.
    fs.writeFileSync(
      path.join(envDir, 'env.json'),
      JSON.stringify({
        prefix: "sh -c '{COMMAND}'",
        env: { HTTP_PROXY: 'http://127.0.0.1:8888' },
      })
    );

    const { stdout } = await env.runCli(['environments', 'check', 'proxy-env-only']);
    expect(stdout).toMatch(/\[PASS\] HTTP_PROXY env var is set to http:\/\/127\.0\.0\.1:8888/);
  }, 60000);

  it('`environments check` errors clearly when the environment is unknown', async () => {
    const { stderr, code } = await env.runCli(['environments', 'check', 'does-not-exist']);
    expect(code).toBe(1);
    expect(stderr + '').toMatch(/Environment 'does-not-exist' not found/);
  }, 30000);
});
