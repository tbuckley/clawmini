import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createE2EContext } from './utils.js';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('propose-policy CLI', () => {
  const { runCli, e2eDir, setupE2E, teardownE2E } = createE2EContext('e2e-propose-policy');
  const binPath = path.resolve(__dirname, '../../../dist/cli/propose-policy.mjs');

  beforeAll(async () => {
    await setupE2E();
    const { code, stderr } = await runCli(['init']);
    if (code !== 0) throw new Error(`Init failed: ${stderr}`);
  });

  afterAll(async () => {
    await teardownE2E();
  });

  function runProposePolicy(
    args: string[]
  ): Promise<{ stdout: string; stderr: string; code: number | null }> {
    return new Promise((resolve) => {
      const child = spawn('node', [binPath, ...args], {
        cwd: e2eDir,
        env: { ...process.env },
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => (stdout += data.toString()));
      child.stderr.on('data', (data) => (stderr += data.toString()));

      child.on('close', (code) => {
        resolve({ stdout, stderr, code });
      });
    });
  }

  it('should fail if missing required arguments', async () => {
    const { stderr, code } = await runProposePolicy([]);
    expect(code).toBe(1);
    expect(stderr).toContain("error: required option '--name <policy_name>' not specified");
  });

  it('should fail if policy name is invalid', async () => {
    const { stderr, code } = await runProposePolicy([
      '--name',
      'Invalid_Name!',
      '--description',
      'Test description',
      '--command',
      'echo test',
    ]);
    expect(code).toBe(1);
    expect(stderr).toContain(
      'Error: Policy name must only contain lowercase letters, numbers, and hyphens.'
    );
  });

  it('should fail if neither command nor script-file is provided', async () => {
    const { stderr, code } = await runProposePolicy([
      '--name',
      'test-policy',
      '--description',
      'Test description',
    ]);
    expect(code).toBe(1);
    expect(stderr).toContain('Error: Must provide either --command or --script-file.');
  });

  it('should create a policy with a command', async () => {
    const { stdout, stderr, code } = await runProposePolicy([
      '--name',
      'echo-test',
      '--description',
      'A simple echo command',
      '--command',
      'echo "Hello World"',
    ]);

    if (code !== 0) console.error(stderr);
    expect(code).toBe(0);
    expect(stdout).toContain("Successfully proposed and registered policy 'echo-test'");

    const policiesPath = path.resolve(e2eDir, '.clawmini/policies.json');
    const policies = JSON.parse(fs.readFileSync(policiesPath, 'utf8'));

    expect(policies.policies['echo-test']).toBeDefined();
    expect(policies.policies['echo-test'].description).toBe('A simple echo command');
    expect(policies.policies['echo-test'].command).toBe('echo');
    expect(policies.policies['echo-test'].args).toEqual(['"Hello', 'World"']);
    expect(policies.policies['echo-test'].allowHelp).toBe(true);
  });

  it('should create a policy with a script file', async () => {
    const scriptPath = path.resolve(e2eDir, 'test-script.sh');
    fs.writeFileSync(scriptPath, '#!/bin/bash\necho "From script"', { mode: 0o755 });

    const { stdout, code } = await runProposePolicy([
      '--name',
      'script-test',
      '--description',
      'A test script policy',
      '--script-file',
      scriptPath,
    ]);

    expect(code).toBe(0);
    expect(stdout).toContain("Successfully proposed and registered policy 'script-test'");

    const destScriptPath = path.resolve(e2eDir, '.clawmini/policy-scripts/script-test.sh');
    expect(fs.existsSync(destScriptPath)).toBe(true);

    const policiesPath = path.resolve(e2eDir, '.clawmini/policies.json');
    const policies = JSON.parse(fs.readFileSync(policiesPath, 'utf8'));

    expect(policies.policies['script-test']).toBeDefined();
    expect(policies.policies['script-test'].command).toBe(
      './.clawmini/policy-scripts/script-test.sh'
    );
  });

  it('should overwrite an existing policy with the same name', async () => {
    // Overwrite the 'echo-test' policy from previous test
    const { stdout, code } = await runProposePolicy([
      '--name',
      'echo-test',
      '--description',
      'An updated echo command',
      '--command',
      'echo "Updated"',
    ]);

    expect(code).toBe(0);
    expect(stdout).toContain("Successfully proposed and registered policy 'echo-test'");

    const policiesPath = path.resolve(e2eDir, '.clawmini/policies.json');
    const policies = JSON.parse(fs.readFileSync(policiesPath, 'utf8'));

    expect(policies.policies['echo-test']).toBeDefined();
    expect(policies.policies['echo-test'].description).toBe('An updated echo command');
    expect(policies.policies['echo-test'].command).toBe('echo');
    expect(policies.policies['echo-test'].args).toEqual(['"Updated"']);
  });
});

describe('propose-policy CLI (uninitialized)', () => {
  const { e2eDir, setupE2E, teardownE2E } = createE2EContext('e2e-propose-policy-uninit');
  const binPath = path.resolve(__dirname, '../../../dist/cli/propose-policy.mjs');

  beforeAll(async () => {
    await setupE2E();
    // Intentionally not running init
  });

  afterAll(async () => {
    await teardownE2E();
  });

  function runProposePolicy(
    args: string[]
  ): Promise<{ stdout: string; stderr: string; code: number | null }> {
    return new Promise((resolve) => {
      const child = spawn('node', [binPath, ...args], {
        cwd: e2eDir,
        env: { ...process.env },
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => (stdout += data.toString()));
      child.stderr.on('data', (data) => (stderr += data.toString()));

      child.on('close', (code) => {
        resolve({ stdout, stderr, code });
      });
    });
  }

  it('should fail if .clawmini directory does not exist', async () => {
    const { stderr, code } = await runProposePolicy([
      '--name',
      'echo-test',
      '--description',
      'A simple echo command',
      '--command',
      'echo "Hello World"',
    ]);

    expect(code).toBe(1);
    expect(stderr).toContain(
      'Error: .clawmini directory not found. Please run "clawmini init" first.'
    );
  });
});
