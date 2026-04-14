import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { TestEnvironment } from '../_helpers/test-environment.js';
import type { CommandLogMessage } from '../../src/daemon/chats.js';

describe('E2E Requests Tests (Lite)', () => {
  let env: TestEnvironment;
  let litePath = '';
  let envUrl = '';
  let envToken = '';
  let agentDir = '';

  beforeAll(async () => {
    env = new TestEnvironment('e2e-tmp-requests');
    await env.setup();
    await env.setupSubagentEnv({
      policies: {
        'test-cmd': {
          description: 'A test policy',
          command: 'echo',
          args: ['hello'],
          allowHelp: true,
        },
        'no-help-cmd': {
          description: 'A no help policy',
          command: 'echo',
          args: ['nohelp'],
        },
        'auto-cmd': {
          description: 'An auto approve policy',
          command: 'echo',
          args: ['autoresult'],
          autoApprove: true,
        },
        'interp-cmd': {
          description: 'Auto-approve cat with {{myfile}} interpolation',
          command: 'cat',
          args: ['{{myfile}}'],
          autoApprove: true,
        },
      },
    });

    litePath = path.resolve(env.e2eDir, 'clawmini-lite.js');
    agentDir = path.resolve(env.e2eDir, 'debug-agent');

    // Extract API credentials by asking debug-agent to echo its env vars.
    await env.runCli(['chats', 'add', 'creds-chat']);
    await env.connect('creds-chat');
    await env.sendMessage(
      'echo "URL=$CLAW_API_URL" && echo "TOKEN=$CLAW_API_TOKEN"',
      { chat: 'creds-chat', agent: 'debug-agent' }
    );
    const log = await env.waitForMessage((m): m is CommandLogMessage => m.role === 'command');
    // Match start-of-line to skip the debug template's own [DEBUG] ... echo
    // line, which contains the literal text "URL=$CLAW_API_URL".
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
        cwd: agentDir,
      });
      let stdout = '';
      let stderr = '';
      p.stdout.on('data', (d) => (stdout += d.toString()));
      p.stderr.on('data', (d) => (stderr += d.toString()));
      p.on('close', (code) => resolve({ stdout, stderr, code }));
    });
  }

  it('should list policies', async () => {
    const { stdout, code } = await runLite(['requests', 'list']);
    expect(code).toBe(0);
    expect(stdout).toContain('Available Policies:');
    expect(stdout).toContain('- test-cmd');
    expect(stdout).toContain('Description: A test policy');
  });

  it('should run --help on underlying command', async () => {
    const { stdout, code } = await runLite(['request', 'test-cmd', '--help']);
    expect(code).toBe(0);
    expect(stdout).toBeTruthy();
  });

  it('should block --help if allowHelp is not true', async () => {
    const { stderr, code } = await runLite(['request', 'no-help-cmd', '--help']);
    expect(code).toBe(1);
    expect(stderr).toContain('This command does not support --help');
  });

  it('should create a request and return an ID', async () => {
    const dummyFilePath = path.join(agentDir, 'dummy.txt');
    await fsPromises.writeFile(dummyFilePath, 'dummy content');

    const { stdout, stderr, code } = await runLite([
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

    const requestsDir = path.join(env.e2eDir, '.clawmini', 'tmp', 'requests');
    const files = (await fsPromises.readdir(requestsDir)).filter((f) => f.endsWith('.json'));
    expect(files.length).toBe(1);

    const req = JSON.parse(await fsPromises.readFile(path.join(requestsDir, files[0]!), 'utf8'));
    expect(req.commandName).toBe('test-cmd');
    expect(req.args).toEqual(['extra1', 'extra2']);
    expect(req.fileMappings).toHaveProperty('target');

    const snapshotContent = await fsPromises.readFile(req.fileMappings.target, 'utf8');
    expect(snapshotContent).toBe('dummy content');
  });

  it('should synchronously output execution result for auto-approved policy', async () => {
    const { stdout, stderr, code } = await runLite(['request', 'auto-cmd', '--', 'extra-auto']);

    expect(stderr).toBe('');
    expect(code).toBe(0);
    expect(stdout.trim()).toBe('autoresult extra-auto');
  });

  it('should interpolate {{placeholder}} in policy args with snapshot path', async () => {
    const sourcePath = path.join(agentDir, 'interp-source.txt');
    await fsPromises.writeFile(sourcePath, 'interpolated file content');

    const { stdout, stderr, code } = await runLite([
      'request',
      'interp-cmd',
      '--file',
      `myfile=interp-source.txt`,
    ]);

    expect(stderr).toBe('');
    expect(code).toBe(0);
    expect(stdout).toContain('interpolated file content');
  });

  describe('--file snapshot security', () => {
    it('should reject a --file path that resolves outside the agent directory', async () => {
      const { stderr, code } = await runLite([
        'request',
        'test-cmd',
        '--file',
        `target=../../../etc/hosts`,
      ]);

      expect(code).toBe(1);
      expect(stderr).toMatch(/Security Error: Path resolves outside/);
    });

    it('should reject a --file pointing at an absolute path outside the agent directory', async () => {
      const { stderr, code } = await runLite([
        'request',
        'test-cmd',
        '--file',
        `target=/etc/hosts`,
      ]);

      expect(code).toBe(1);
      expect(stderr).toMatch(/Security Error: Path resolves outside/);
    });

    it('should reject a --file that is a symlink', async () => {
      fs.symlinkSync('/etc/hosts', path.join(agentDir, 'link-to-host.txt'));

      const { stderr, code } = await runLite([
        'request',
        'test-cmd',
        '--file',
        `target=link-to-host.txt`,
      ]);

      expect(code).toBe(1);
      expect(stderr).toMatch(/Security Error: Symlinks are not allowed/);
    });

    it('should reject a --file larger than the 5MB snapshot cap', async () => {
      await fsPromises.writeFile(path.join(agentDir, 'big.bin'), Buffer.alloc(6 * 1024 * 1024));

      const { stderr, code } = await runLite([
        'request',
        'test-cmd',
        '--file',
        `target=big.bin`,
      ]);

      expect(code).toBe(1);
      expect(stderr).toMatch(/exceeds maximum snapshot size of 5MB/);
    });

    it('should reject a --file pointing at a directory', async () => {
      fs.mkdirSync(path.join(agentDir, 'a-directory'));

      const { stderr, code } = await runLite([
        'request',
        'test-cmd',
        '--file',
        `target=a-directory`,
      ]);

      expect(code).toBe(1);
      expect(stderr).toMatch(/Requested path is not a file/);
    });
  });
});
