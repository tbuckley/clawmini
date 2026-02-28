import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createE2EContext } from './utils.js';

const { runCli, setupE2E, teardownE2E } = createE2EContext('e2e-tmp-cron');

describe('E2E Cron Tests', () => {
  beforeAll(async () => {
    await setupE2E();
    await runCli(['init']);
  }, 30000);

  afterAll(async () => {
    await teardownE2E();
  }, 30000);

  it('should add, list, and delete cron jobs', async () => {
    // 1. Add a cron job
    const { stdout: stdoutAdd, code: codeAdd } = await runCli([
      'cron',
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
      'type=new',
    ]);
    expect(codeAdd).toBe(0);
    expect(stdoutAdd).toContain("Cron job 'test-job-1' created successfully.");

    // 2. List cron jobs
    const { stdout: stdoutList1, code: codeList1 } = await runCli(['cron', 'list']);
    expect(codeList1).toBe(0);
    expect(stdoutList1).toContain('- test-job-1 (every: 10m)');

    // 3. Add a second cron job using cron expression
    const { stdout: stdoutAdd2, code: codeAdd2 } = await runCli([
      'cron',
      'add',
      'test-job-2',
      '--cron',
      '* * * * *',
    ]);
    expect(codeAdd2).toBe(0);
    expect(stdoutAdd2).toContain("Cron job 'test-job-2' created successfully.");

    const { stdout: stdoutList2 } = await runCli(['cron', 'list']);
    expect(stdoutList2).toContain('- test-job-1 (every: 10m)');
    expect(stdoutList2).toContain('- test-job-2 (cron: * * * * *)');

    // 4. Delete the first job
    const { stdout: stdoutDelete, code: codeDelete } = await runCli([
      'cron',
      'delete',
      'test-job-1',
    ]);
    expect(codeDelete).toBe(0);
    expect(stdoutDelete).toContain("Cron job 'test-job-1' deleted successfully.");

    const { stdout: stdoutList3 } = await runCli(['cron', 'list']);
    expect(stdoutList3).not.toContain('test-job-1');
    expect(stdoutList3).toContain('- test-job-2 (cron: * * * * *)');
  });
});
