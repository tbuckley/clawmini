import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TestEnvironment } from '../_helpers/test-environment.js';

describe('E2E Cron Tests', () => {
  let env: TestEnvironment;

  beforeAll(async () => {
    env = new TestEnvironment('e2e-tmp-cron');
    await env.setup();
    await env.init();
  }, 30000);

  afterAll(() => env.teardown(), 30000);

  it('should add, list, and delete jobs', async () => {
    // 1. Add a job
    const { stdout: stdoutAdd, code: codeAdd } = await env.runCli([
      'jobs',
      'add',
      'test-job-1',
      '--message',
      'hello world',
      '--every',
      '10m',
      '--agent',
      'my-agent',
      '--env',
      'FOO=BAR',
      '--session',
      'new',
    ]);
    expect(codeAdd).toBe(0);
    expect(stdoutAdd).toContain("Job 'test-job-1' created successfully.");

    // 2. List jobs
    const { stdout: stdoutList1, code: codeList1 } = await env.runCli(['jobs', 'list']);
    expect(codeList1).toBe(0);
    expect(stdoutList1).toContain('- test-job-1 (every: 10m)');

    // 2b. Verify flags persisted via JSON output
    const { stdout: stdoutJson1, code: codeJson1 } = await env.runCli(['jobs', 'list', '--json']);
    expect(codeJson1).toBe(0);
    const jobs1 = JSON.parse(stdoutJson1);
    expect(jobs1).toHaveLength(1);
    expect(jobs1[0]).toMatchObject({
      id: 'test-job-1',
      message: 'hello world',
      agentId: 'my-agent',
      env: { FOO: 'BAR' },
      session: { type: 'new' },
      schedule: { every: '10m' },
    });

    // 3. Add a second job using cron expression
    const { stdout: stdoutAdd2, code: codeAdd2 } = await env.runCli([
      'jobs',
      'add',
      'test-job-2',
      '--cron',
      '* * * * *',
    ]);
    expect(codeAdd2).toBe(0);
    expect(stdoutAdd2).toContain("Job 'test-job-2' created successfully.");

    const { stdout: stdoutList2 } = await env.runCli(['jobs', 'list']);
    expect(stdoutList2).toContain('- test-job-1 (every: 10m)');
    expect(stdoutList2).toContain('- test-job-2 (cron: * * * * *)');

    // 4. Delete the first job
    const { stdout: stdoutDelete, code: codeDelete } = await env.runCli([
      'jobs',
      'delete',
      'test-job-1',
    ]);
    expect(codeDelete).toBe(0);
    expect(stdoutDelete).toContain("Job 'test-job-1' deleted successfully.");

    const { stdout: stdoutList3 } = await env.runCli(['jobs', 'list']);
    expect(stdoutList3).not.toContain('test-job-1');
    expect(stdoutList3).toContain('- test-job-2 (cron: * * * * *)');
  }, 15000);

  it('should execute a job and inherit chat default agent and session', async () => {
    // 1. Create a specific agent for this chat
    await env.runCli(['agents', 'add', 'cron-exec-agent']);
    const agentSettings = env.getAgentSettings('cron-exec-agent');
    agentSettings.commands = {
      new: 'echo "executed with $SESSION_ID and msg: $CLAW_CLI_MESSAGE"',
    };
    env.writeAgentSettings('cron-exec-agent', agentSettings);

    // 2. Setup the chat with this agent and get a session ID
    await env.runCli(['chats', 'add', 'cron-chat']);
    const { code: codeSetup, stderr: stderrSetup } = await env.runCli([
      'messages',
      'send',
      'setup session',
      '-c',
      'cron-chat',
      '-a',
      'cron-exec-agent',
    ]);
    if (codeSetup !== 0) console.error(stderrSetup);
    expect(codeSetup).toBe(0);

    // 3. Schedule a job for 2 seconds in the future
    const futureTime = new Date(Date.now() + 2000).toISOString();
    const { stdout: stdoutAdd, code: codeAdd } = await env.runCli([
      'jobs',
      'add',
      'test-exec-job',
      '-c',
      'cron-chat',
      '--at',
      futureTime,
      '--message',
      'hello from future',
    ]);
    expect(codeAdd).toBe(0);
    expect(stdoutAdd).toContain("Job 'test-exec-job' created successfully.");

    // 4. Wait for job to execute (approx 3 seconds)
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // 5. Check if the message was sent and properly inherited the agent and session
    const { stdout: stdoutHistory } = await env.runCli(['messages', 'tail', '-c', 'cron-chat']);

    // It should have executed the cron job
    expect(stdoutHistory).toContain('hello from future');
    // It should have used cron-exec-agent, not default
    expect(stdoutHistory).toContain('msg: hello from future');

    // One-off --at jobs should be removed from settings after firing.
    const { stdout: stdoutListAfter } = await env.runCli(['jobs', 'list', '-c', 'cron-chat']);
    expect(stdoutListAfter).not.toContain('test-exec-job');
  }, 10000);

  it('should reject jobs with invalid --at date format', async () => {
    const { stderr, code } = await env.runCli([
      'jobs',
      'add',
      'invalid-job',
      '--at',
      'invalid-date',
    ]);
    expect(code).not.toBe(0);
    expect(stderr).toContain("Invalid date format for 'at' schedule: invalid-date");
  });
});
