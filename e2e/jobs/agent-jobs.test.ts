import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TestEnvironment } from '../_helpers/test-environment.js';

describe('E2E Agent Jobs (Lite)', () => {
  let env: TestEnvironment;
  let envUrl = '';
  let envToken = '';

  beforeAll(async () => {
    env = new TestEnvironment('e2e-tmp-agent-jobs');
    await env.setup();
    await env.setupSubagentEnv();
    ({ url: envUrl, token: envToken } = await env.getAgentCredentials());
  }, 30000);

  afterAll(() => env.teardown(), 30000);

  // Filter out the session-timeout fixture job scheduled automatically by the
  // debug-agent's router pipeline so assertions focus on user-added jobs.
  async function listUserJobs(): Promise<Array<Record<string, unknown>>> {
    const { stdout, code } = await env.runLite(['jobs', 'list']);
    expect(code).toBe(0);
    const all = JSON.parse(stdout) as Array<Record<string, unknown>>;
    return all.filter(
      (j) => !(typeof j.id === 'string' && j.id.startsWith('__session_timeout__'))
    );
  }

  it('should return a parseable JSON array from list', async () => {
    const { stdout, code } = await env.runLite(['jobs', 'list']);
    expect(code).toBe(0);
    expect(Array.isArray(JSON.parse(stdout))).toBe(true);
  });

  it('should add a job with the allowed flags and stamp agentId from the token', async () => {
    const { stdout, code } = await env.runLite([
      'jobs', 'add', 'agent-job-1',
      '--every', '999h',
      '--message', 'hello from agent',
      '--reply', 'queued',
      '--session', 'new',
    ]);
    expect(code).toBe(0);
    expect(stdout).toContain("Job 'agent-job-1' created successfully.");

    const jobs = await listUserJobs();
    const job = jobs.find((j) => j.id === 'agent-job-1');
    expect(job).toMatchObject({
      id: 'agent-job-1',
      message: 'hello from agent',
      reply: 'queued',
      // Server stamps agentId from the token rather than accepting it as input.
      agentId: 'debug-agent',
      session: { type: 'new' },
      schedule: { every: '999h' },
    });
    // Internal-only fields must never leak in from agent input.
    expect(job).not.toHaveProperty('env');
    expect(job).not.toHaveProperty('action');
    expect(job).not.toHaveProperty('nextSessionId');
  });

  it('should reject job input containing internal-only fields', async () => {
    const attempts = [
      { id: 'bad-env', schedule: { every: '999h' }, env: { FOO: 'BAR' } },
      { id: 'bad-action', schedule: { every: '999h' }, action: 'stop' },
      { id: 'bad-agent', schedule: { every: '999h' }, agentId: 'someone-else' },
      { id: 'bad-next', schedule: { every: '999h' }, nextSessionId: 'abc' },
    ];

    for (const job of attempts) {
      const res = await fetch(`${envUrl}/addCronJob`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${envToken}`,
        },
        body: JSON.stringify({ job }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error?: { message?: string } };
      expect(body.error?.message ?? '').toMatch(/unrecognized|invalid/i);
    }

    const jobs = await listUserJobs();
    for (const attempt of attempts) {
      expect(jobs.find((j) => j.id === attempt.id)).toBeUndefined();
    }
  });

  it('should add a job with --cron schedule', async () => {
    const { code } = await env.runLite([
      'jobs', 'add', 'agent-job-cron',
      '--cron', '0 0 * * *',
      '--message', 'nightly',
    ]);
    expect(code).toBe(0);

    const jobs = await listUserJobs();
    const job = jobs.find((j) => j.id === 'agent-job-cron');
    expect(job).toMatchObject({ schedule: { cron: '0 0 * * *' }, message: 'nightly' });
  });

  it('should add a job with --at schedule (interval), execute it, and auto-delete it', async () => {
    const { code, stdout } = await env.runLite([
      'jobs', 'add', 'agent-job-at-interval',
      '--at', '2s',
      '--message', 'hello from 2s interval',
      '--reply', 'queued',
      '--session', 'new',
    ]);
    expect(code).toBe(0);
    expect(stdout).toContain("Job 'agent-job-at-interval' created successfully.");

    let jobs = await listUserJobs();
    let job = jobs.find((j) => j.id === 'agent-job-at-interval');
    expect(job).toMatchObject({
      schedule: { at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) },
      message: 'hello from 2s interval'
    });

    // Wait for the job to execute
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // The job should be auto-deleted
    jobs = await listUserJobs();
    job = jobs.find((j) => j.id === 'agent-job-at-interval');
    expect(job).toBeUndefined();
  }, 10000);

  it('should add a job with --at schedule (timestamp), execute it, and auto-delete it', async () => {
    const futureTime = new Date(Date.now() + 2000).toISOString();
    const { code, stdout } = await env.runLite([
      'jobs', 'add', 'agent-job-at-timestamp',
      '--at', futureTime,
      '--message', 'hello from timestamp',
      '--reply', 'queued',
      '--session', 'new',
    ]);
    expect(code).toBe(0);
    expect(stdout).toContain("Job 'agent-job-at-timestamp' created successfully.");

    let jobs = await listUserJobs();
    let job = jobs.find((j) => j.id === 'agent-job-at-timestamp');
    expect(job).toMatchObject({ schedule: { at: futureTime }, message: 'hello from timestamp' });

    // Wait for the job to execute
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // The job should be auto-deleted
    jobs = await listUserJobs();
    job = jobs.find((j) => j.id === 'agent-job-at-timestamp');
    expect(job).toBeUndefined();
  }, 10000);

  it('should reject jobs with no schedule flag', async () => {
    const { stderr, code } = await env.runLite(['jobs', 'add', 'no-sched', '--message', 'x']);
    expect(code).toBe(1);
    expect(stderr).toContain('A schedule must be specified');
  });

  it('should reject --session values other than "new"', async () => {
    const { stderr, code } = await env.runLite([
      'jobs', 'add', 'bad-session',
      '--every', '999h',
      '--session', 'bogus',
    ]);
    expect(code).toBe(1);
    expect(stderr).toContain('Only "new" session type is supported');
  });

  it('should replace a job when adding the same id twice', async () => {
    await env.runLite(['jobs', 'add', 'dup-job', '--every', '999h', '--message', 'first']);
    const { code } = await env.runLite([
      'jobs', 'add', 'dup-job',
      '--every', '888h',
      '--message', 'second',
    ]);
    expect(code).toBe(0);

    const jobs = await listUserJobs();
    const matches = jobs.filter((j) => j.id === 'dup-job');
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      message: 'second',
      schedule: { every: '888h' },
    });
  });

  it('should delete an existing job', async () => {
    await env.runLite(['jobs', 'add', 'del-me', '--every', '999h']);
    const { stdout, code } = await env.runLite(['jobs', 'delete', 'del-me']);
    expect(code).toBe(0);
    expect(stdout).toContain("Job 'del-me' deleted successfully.");

    const jobs = await listUserJobs();
    expect(jobs.find((j) => j.id === 'del-me')).toBeUndefined();
  });

  it('should report "not found" when deleting a missing job', async () => {
    const { stdout, code } = await env.runLite(['jobs', 'delete', 'does-not-exist']);
    expect(code).toBe(0);
    expect(stdout).toContain("Job 'does-not-exist' not found.");
  });
});
