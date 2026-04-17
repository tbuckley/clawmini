import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TestEnvironment } from '../_helpers/test-environment.js';

// Covers what happens to scheduled jobs when the daemon stops and starts
// again — a case the other files do not exercise (they keep one daemon up
// for the whole describe block).
describe('E2E Job Restart Behavior', () => {
  let env: TestEnvironment;

  beforeAll(async () => {
    env = new TestEnvironment('e2e-tmp-jobs-restart');
    await env.setup();
    await env.init();

    await env.runCli(['agents', 'add', 'restart-agent']);
    env.updateAgentSettings('restart-agent', {
      commands: { new: 'echo "[restart-agent] msg: $CLAW_CLI_MESSAGE"' },
    });
  }, 30000);

  afterAll(() => env.teardown(), 30000);

  it('fires overdue --at jobs after the daemon restarts and removes them', async () => {
    await env.addChat('restart-at-chat');
    // Pin the chat to restart-agent so the cron firing routes through our
    // echo command (the job below specifies no agentId and inherits).
    const setup = await env.runCli([
      'messages', 'send', 'setup',
      '-c', 'restart-at-chat',
      '-a', 'restart-agent',
    ]);
    expect(setup.code).toBe(0);

    // Schedule for ~5s out — enough margin to call down() before the
    // running daemon's scheduler can fire the job.
    const futureTime = new Date(Date.now() + 5000).toISOString();
    const add = await env.runCli([
      'jobs', 'add', 'overdue-job',
      '-c', 'restart-at-chat',
      '--at', futureTime,
      '--message', 'caught up after restart',
    ]);
    expect(add.code).toBe(0);

    await env.down();

    // Block past the target time so the job is overdue when the daemon
    // comes back up.
    await new Promise((r) => setTimeout(r, 6000));

    await env.up();
    // Give the cron manager time to detect the overdue job (~100ms scheduling
    // delay in cron.ts) plus the agent's command execution.
    await new Promise((r) => setTimeout(r, 3000));

    const { stdout: history } = await env.runCli([
      'messages', 'tail', '-c', 'restart-at-chat',
    ]);
    expect(history).toContain('caught up after restart');
    expect(history).toContain('msg: caught up after restart');

    const { stdout: jobsList } = await env.runCli([
      'jobs', 'list', '-c', 'restart-at-chat',
    ]);
    expect(jobsList).not.toContain('overdue-job');
  }, 30000);

  // Documents current behavior: cron/every ticks that elapse while the
  // daemon is down are silently dropped — the next tick is scheduled, but
  // missed ones are not backfilled.
  it('does not backfill cron ticks missed while the daemon was down', async () => {
    await env.addChat('restart-cron-chat');
    const setup = await env.runCli([
      'messages', 'send', 'setup',
      '-c', 'restart-cron-chat',
      '-a', 'restart-agent',
    ]);
    expect(setup.code).toBe(0);

    // Daily-at-midnight: outside the rare midnight window, the previous
    // tick is hours in the past and the next tick is hours in the future,
    // so nothing should fire during the test regardless of restart timing.
    const add = await env.runCli([
      'jobs', 'add', 'nightly-job',
      '-c', 'restart-cron-chat',
      '--cron', '0 0 * * *',
      '--message', 'should-not-fire-on-restart',
    ]);
    expect(add.code).toBe(0);

    await env.down();
    await env.up();

    // Give any (unwanted) immediate firing a chance to land before
    // asserting it didn't happen.
    await new Promise((r) => setTimeout(r, 3000));

    const { stdout: history } = await env.runCli([
      'messages', 'tail', '-c', 'restart-cron-chat',
    ]);
    expect(history).not.toContain('should-not-fire-on-restart');

    const { stdout: jobsList } = await env.runCli([
      'jobs', 'list', '-c', 'restart-cron-chat',
    ]);
    expect(jobsList).toContain('nightly-job');
  }, 30000);
});
