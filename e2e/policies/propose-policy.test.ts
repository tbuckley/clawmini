import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TestEnvironment } from '../_helpers/test-environment.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const binPath = path.resolve(__dirname, '../../dist/cli/propose-policy.mjs');

describe('propose-policy CLI', () => {
  let env: TestEnvironment;

  beforeAll(async () => {
    env = new TestEnvironment('e2e-propose-policy');
    await env.setup();
    const { code, stderr } = await env.init();
    if (code !== 0) throw new Error(`Init failed: ${stderr}`);
  });

  afterAll(() => env.teardown(), 30000);

  it('should fail if missing required arguments', async () => {
    const { stderr, code } = await env.runBin(binPath, []);
    expect(code).toBe(1);
    expect(stderr).toContain("error: required option '--name <policy_name>' not specified");
  });

  it('should fail if policy name is invalid', async () => {
    const { stderr, code } = await env.runBin(binPath, [
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
    const { stderr, code } = await env.runBin(binPath, [
      '--name',
      'test-policy',
      '--description',
      'Test description',
    ]);
    expect(code).toBe(1);
    expect(stderr).toContain('Error: Must provide either --command or --script-file.');
  });

  it('should create a policy with a command', async () => {
    const { stdout, stderr, code } = await env.runBin(binPath, [
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

    const policiesPath = path.resolve(env.e2eDir, '.clawmini/policies.json');
    const policies = JSON.parse(fs.readFileSync(policiesPath, 'utf8'));

    expect(policies.policies['echo-test']).toBeDefined();
    expect(policies.policies['echo-test'].description).toBe('A simple echo command');
    expect(policies.policies['echo-test'].command).toBe('echo');
    expect(policies.policies['echo-test'].args).toEqual(['"Hello', 'World"']);
    expect(policies.policies['echo-test'].allowHelp).toBe(true);
  });

  it('should create a policy with a script file', async () => {
    const scriptPath = path.resolve(env.e2eDir, 'test-script.sh');
    fs.writeFileSync(scriptPath, '#!/bin/bash\necho "From script"', { mode: 0o755 });

    const { stdout, code } = await env.runBin(binPath, [
      '--name',
      'script-test',
      '--description',
      'A test script policy',
      '--script-file',
      scriptPath,
    ]);

    expect(code).toBe(0);
    expect(stdout).toContain("Successfully proposed and registered policy 'script-test'");

    const destScriptPath = path.resolve(env.e2eDir, '.clawmini/policy-scripts/script-test.sh');
    expect(fs.existsSync(destScriptPath)).toBe(true);

    const policiesPath = path.resolve(env.e2eDir, '.clawmini/policies.json');
    const policies = JSON.parse(fs.readFileSync(policiesPath, 'utf8'));

    expect(policies.policies['script-test']).toBeDefined();
    expect(policies.policies['script-test'].command).toBe(
      './.clawmini/policy-scripts/script-test.sh'
    );
  });

  it('should overwrite an existing policy with the same name', async () => {
    // Overwrite the 'echo-test' policy from previous test
    const { stdout, code } = await env.runBin(binPath, [
      '--name',
      'echo-test',
      '--description',
      'An updated echo command',
      '--command',
      'echo "Updated"',
    ]);

    expect(code).toBe(0);
    expect(stdout).toContain("Successfully proposed and registered policy 'echo-test'");

    const policiesPath = path.resolve(env.e2eDir, '.clawmini/policies.json');
    const policies = JSON.parse(fs.readFileSync(policiesPath, 'utf8'));

    expect(policies.policies['echo-test']).toBeDefined();
    expect(policies.policies['echo-test'].description).toBe('An updated echo command');
    expect(policies.policies['echo-test'].command).toBe('echo');
    expect(policies.policies['echo-test'].args).toEqual(['"Updated"']);
  });
});

describe('propose-policy CLI (uninitialized)', () => {
  let env: TestEnvironment;

  beforeAll(async () => {
    env = new TestEnvironment('e2e-propose-policy-uninit');
    await env.setup();
  });

  afterAll(() => env.teardown(), 30000);

  it('should fail if .clawmini directory does not exist', async () => {
    const { stderr, code } = await env.runBin(binPath, [
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
