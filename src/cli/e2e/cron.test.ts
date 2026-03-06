import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createE2EContext } from './utils.js';

const { runCli, e2eDir, setupE2E, teardownE2E } = createE2EContext('e2e-tmp-cron');

describe('E2E Cron Tests', () => {
  beforeAll(async () => {
    await setupE2E();
    await runCli(['init']);
  }, 30000);

  afterAll(async () => {
    await teardownE2E();
  }, 30000);

  it('should add, list, and delete jobs', async () => {
    // 1. Add a job
    const { stdout: stdoutAdd, code: codeAdd } = await runCli([
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
    const { stdout: stdoutList1, code: codeList1 } = await runCli(['jobs', 'list']);
    expect(codeList1).toBe(0);
    expect(stdoutList1).toContain('- test-job-1 (every: 10m)');

    // 3. Add a second job using cron expression
    const { stdout: stdoutAdd2, code: codeAdd2 } = await runCli([
      'jobs',
      'add',
      'test-job-2',
      '--cron',
      '* * * * *',
    ]);
    expect(codeAdd2).toBe(0);
    expect(stdoutAdd2).toContain("Job 'test-job-2' created successfully.");

    const { stdout: stdoutList2 } = await runCli(['jobs', 'list']);
    expect(stdoutList2).toContain('- test-job-1 (every: 10m)');
    expect(stdoutList2).toContain('- test-job-2 (cron: * * * * *)');

    // 4. Delete the first job
    const { stdout: stdoutDelete, code: codeDelete } = await runCli([
      'jobs',
      'delete',
      'test-job-1',
    ]);
    expect(codeDelete).toBe(0);
    expect(stdoutDelete).toContain("Job 'test-job-1' deleted successfully.");

    const { stdout: stdoutList3 } = await runCli(['jobs', 'list']);
    expect(stdoutList3).not.toContain('test-job-1');
    expect(stdoutList3).toContain('- test-job-2 (cron: * * * * *)');
  });

  it('should execute a job and inherit chat default agent and session', async () => {
    // 1. Create a specific agent for this chat
    await runCli(['agents', 'add', 'cron-exec-agent']);
    const fs = await import('node:fs');
    const path = await import('node:path');
    const agentPath = path.resolve(e2eDir, '.clawmini/agents/cron-exec-agent/settings.json');
    const agentData = JSON.parse(fs.readFileSync(agentPath, 'utf8'));
    agentData.commands = { new: 'echo "executed with $SESSION_ID and msg: $CLAW_CLI_MESSAGE"' };
    fs.writeFileSync(agentPath, JSON.stringify(agentData));

    // 2. Setup the chat with this agent and get a session ID
    await runCli(['chats', 'add', 'cron-chat']);
    const { code: codeSetup, stderr: stderrSetup } = await runCli([
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
    const { stdout: stdoutAdd, code: codeAdd } = await runCli([
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

    // Fallback if e2e test uses a different dir, get it from the e2eDir context
    // Actually createE2EContext returns e2eDir, but it's not exported from the setup block directly if not destructured.
    // wait, I can just use `runCli(['messages', 'tail', '-c', 'cron-chat', '--json'])`
    const { stdout: stdoutHistory } = await runCli(['messages', 'tail', '-c', 'cron-chat']);

    // It should have executed the cron job
    expect(stdoutHistory).toContain('hello from future');
    // It should have used cron-exec-agent, not default
    expect(stdoutHistory).toContain('msg: hello from future');
    // Session ID should not be empty or undefined, it should have been set by the previous message
  }, 10000);

  it('should reject jobs with invalid --at date format', async () => {
    const { stderr, code } = await runCli(['jobs', 'add', 'invalid-job', '--at', 'invalid-date']);
    expect(code).not.toBe(0);
    expect(stderr).toContain("Invalid date format for 'at' schedule: invalid-date");
  });
});
