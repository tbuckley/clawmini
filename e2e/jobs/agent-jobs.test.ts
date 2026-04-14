import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { TestEnvironment } from '../_helpers/test-environment.js';
import type { CommandLogMessage } from '../../src/daemon/chats.js';

describe('E2E Agent Jobs (Lite)', () => {
  let env: TestEnvironment;
  let litePath = '';
  let envUrl = '';
  let envToken = '';

  beforeAll(async () => {
    env = new TestEnvironment('e2e-tmp-agent-jobs');
    await env.setup();
    await env.setupSubagentEnv();

    litePath = path.resolve(env.e2eDir, 'clawmini-lite.js');

    // Extract API credentials by asking the debug agent to echo its env vars.
    await env.runCli(['chats', 'add', 'jobs-chat']);
    await env.connect('jobs-chat');
    await env.sendMessage('echo "URL=$CLAW_API_URL" && echo "TOKEN=$CLAW_API_TOKEN"', {
      chat: 'jobs-chat',
      agent: 'debug-agent',
    });
    const log = await env.waitForMessage((m): m is CommandLogMessage => m.role === 'command');
    envUrl = log.stdout.match(/^URL=(.+)$/m)![1]!.trim();
    envToken = log.stdout.match(/^TOKEN=(.+)$/m)![1]!.trim();
    await env.disconnect();
  }, 30000);

  afterAll(() => env.teardown(), 30000);

  function runLite(
    args: string[]
  ): Promise<{ stdout: string; stderr: string; code: number | null }> {
    return new Promise((resolve) => {
      const p = spawn('node', [litePath, ...args], {
        env: { ...process.env, CLAW_API_URL: envUrl, CLAW_API_TOKEN: envToken },
        cwd: env.e2eDir,
      });
      let stdout = '';
      let stderr = '';
      p.stdout.on('data', (d) => (stdout += d.toString()));
      p.stderr.on('data', (d) => (stderr += d.toString()));
      p.on('close', (code) => resolve({ stdout, stderr, code }));
    });
  }

  // Filter out the session-timeout fixture job scheduled automatically by the
  // debug-agent's router pipeline so assertions focus on user-added jobs.
  async function listUserJobs(): Promise<Array<Record<string, unknown>>> {
    const { stdout, code } = await runLite(['jobs', 'list']);
    expect(code).toBe(0);
    const all = JSON.parse(stdout) as Array<Record<string, unknown>>;
    return all.filter(
      (j) => !(typeof j.id === 'string' && j.id.startsWith('__session_timeout__'))
    );
  }

  it('should return a parseable JSON array from list', async () => {
    const { stdout, code } = await runLite(['jobs', 'list']);
    expect(code).toBe(0);
    expect(Array.isArray(JSON.parse(stdout))).toBe(true);
  });

  it('should add a job with the allowed flags and stamp agentId from the token', async () => {
    const { stdout, code } = await runLite([
      'jobs',
      'add',
      'agent-job-1',
      '--every',
      '999h',
      '--message',
      'hello from agent',
      '--reply',
      'queued',
      '--session',
      'new',
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
    const { code } = await runLite([
      'jobs',
      'add',
      'agent-job-cron',
      '--cron',
      '0 0 * * *',
      '--message',
      'nightly',
    ]);
    expect(code).toBe(0);

    const jobs = await listUserJobs();
    const job = jobs.find((j) => j.id === 'agent-job-cron');
    expect(job).toMatchObject({ schedule: { cron: '0 0 * * *' }, message: 'nightly' });
  });

  it('should reject jobs with no schedule flag', async () => {
    const { stderr, code } = await runLite(['jobs', 'add', 'no-sched', '--message', 'x']);
    expect(code).toBe(1);
    expect(stderr).toContain('A schedule must be specified');
  });

  it('should reject --session values other than "new"', async () => {
    const { stderr, code } = await runLite([
      'jobs',
      'add',
      'bad-session',
      '--every',
      '999h',
      '--session',
      'bogus',
    ]);
    expect(code).toBe(1);
    expect(stderr).toContain('Only "new" session type is supported');
  });

  it('should replace a job when adding the same id twice', async () => {
    await runLite(['jobs', 'add', 'dup-job', '--every', '999h', '--message', 'first']);
    const { code } = await runLite([
      'jobs',
      'add',
      'dup-job',
      '--every',
      '888h',
      '--message',
      'second',
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
    await runLite(['jobs', 'add', 'del-me', '--every', '999h']);
    const { stdout, code } = await runLite(['jobs', 'delete', 'del-me']);
    expect(code).toBe(0);
    expect(stdout).toContain("Job 'del-me' deleted successfully.");

    const jobs = await listUserJobs();
    expect(jobs.find((j) => j.id === 'del-me')).toBeUndefined();
  });

  it('should report "not found" when deleting a missing job', async () => {
    const { stdout, code } = await runLite(['jobs', 'delete', 'does-not-exist']);
    expect(code).toBe(0);
    expect(stdout).toContain("Job 'does-not-exist' not found.");
  });
});
