import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createE2EContext } from './utils.js';

const { runCli, e2eDir, setupE2E, teardownE2E } = createE2EContext('e2e-tmp-requests');

describe('E2E Requests Tests', () => {
  beforeAll(setupE2E, 30000);
  afterAll(teardownE2E, 30000);

  it('should run init', async () => {
    const { code } = await runCli(['init']);
    expect(code).toBe(0);
  });

  it('should write policies.json', async () => {
    const policiesPath = path.join(e2eDir, '.clawmini', 'policies.json');
    await fs.writeFile(
      policiesPath,
      JSON.stringify({
        policies: {
          'test-cmd': {
            description: 'A test policy',
            command: 'echo',
            args: ['hello'],
          },
        },
      })
    );
  });

  it('should list policies', async () => {
    // This command will also auto-start the daemon.
    const { stdout, code } = await runCli(['requests', 'list']);
    expect(code).toBe(0);
    expect(stdout).toContain('Available Policies:');
    expect(stdout).toContain('- test-cmd');
    expect(stdout).toContain('Description: A test policy');
  });

  it('should run --help on underlying command', async () => {
    // Wait for the daemon socket to be completely ready.
    // list command does this, but occasionally it can race.
    // The previous test handles it usually.
    const { stdout, code } = await runCli(['request', 'test-cmd', '--help']);
    expect(code).toBe(0);
    // echo --help might just print --help or might print standard help text, depending on OS.
    // On macOS, echo --help prints "--help"
    expect(stdout).toBeTruthy();
  });

  it('should create a request and return an ID', async () => {
    const dummyFilePath = path.join(e2eDir, 'dummy.txt');
    await fs.writeFile(dummyFilePath, 'dummy content');

    const { stdout, stderr, code } = await runCli([
      'request',
      'test-cmd',
      '--file',
      `target=${dummyFilePath}`,
      '--',
      'extra1',
      'extra2',
    ]);

    expect(stderr).toBe('');
    expect(code).toBe(0);
    expect(stdout).toContain('Request created successfully.');
    expect(stdout).toContain('Request ID:');

    // Verify the request was saved
    const requestsDir = path.join(e2eDir, '.clawmini', 'tmp', 'requests');
    const files = await fs.readdir(requestsDir);
    const jsonFiles = files.filter((f) => f.endsWith('.json'));
    expect(jsonFiles.length).toBe(1);

    const reqData = await fs.readFile(path.join(requestsDir, jsonFiles[0]!), 'utf8');
    const req = JSON.parse(reqData);

    expect(req.commandName).toBe('test-cmd');
    expect(req.args).toEqual(['extra1', 'extra2']);
    expect(req.fileMappings).toHaveProperty('target');

    // Check snapshot exists
    const snapshotPath = req.fileMappings.target;
    const snapshotContent = await fs.readFile(snapshotPath, 'utf8');
    expect(snapshotContent).toBe('dummy content');
  });
});
