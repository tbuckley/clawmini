import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TestEnvironment } from '../_helpers/test-environment.js';

// Basic CRUD for jobs is covered via lite in agent-jobs.test.ts. This file
// covers behavior that only emerges through the scheduler/full CLI: firing a
// scheduled `--at` job, inheriting chat defaults, and CLI-level date parsing.

describe('E2E Cron Tests', () => {
  let env: TestEnvironment;

  beforeAll(async () => {
    env = new TestEnvironment('e2e-tmp-cron');
    await env.setup();
    await env.init();
  }, 30000);

  afterAll(() => env.teardown(), 30000);

  it('should execute a job and inherit chat default agent and session', async () => {
    await env.runCli(['agents', 'add', 'cron-exec-agent']);
    env.updateAgentSettings('cron-exec-agent', {
      commands: { new: 'echo "executed with $SESSION_ID and msg: $CLAW_CLI_MESSAGE"' },
    });

    await env.addChat('cron-chat');
    const { code: codeSetup, stderr: stderrSetup } = await env.runCli([
      'messages', 'send', 'setup session',
      '-c', 'cron-chat',
      '-a', 'cron-exec-agent',
    ]);
    if (codeSetup !== 0) console.error(stderrSetup);
    expect(codeSetup).toBe(0);

    const futureTime = new Date(Date.now() + 2000).toISOString();
    const { stdout: stdoutAdd, code: codeAdd } = await env.runCli([
      'jobs', 'add', 'test-exec-job',
      '-c', 'cron-chat',
      '--at', futureTime,
      '--message', 'hello from future',
    ]);
    expect(codeAdd).toBe(0);
    expect(stdoutAdd).toContain("Job 'test-exec-job' created successfully.");

    await new Promise((resolve) => setTimeout(resolve, 3000));

    const { stdout: stdoutHistory } = await env.runCli(['messages', 'tail', '-c', 'cron-chat']);
    expect(stdoutHistory).toContain('hello from future');
    // Confirms cron-exec-agent (not default) ran the job.
    expect(stdoutHistory).toContain('msg: hello from future');

    // One-off --at jobs should be removed from settings after firing.
    const { stdout: stdoutListAfter } = await env.runCli(['jobs', 'list', '-c', 'cron-chat']);
    expect(stdoutListAfter).not.toContain('test-exec-job');
  }, 10000);

  it('should reject jobs with invalid --at date format', async () => {
    const { stderr, code } = await env.runCli([
      'jobs', 'add', 'invalid-job',
      '--at', 'invalid-date',
    ]);
    expect(code).not.toBe(0);
    expect(stderr).toContain("Invalid date format for 'at' schedule: invalid-date");
  });
});
