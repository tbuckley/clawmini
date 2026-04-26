import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TestEnvironment } from '../_helpers/test-environment.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const binPath = path.resolve(__dirname, '../../dist/cli/manage-policies.mjs');

describe('manage-policies add', () => {
  let env: TestEnvironment;

  beforeAll(async () => {
    env = new TestEnvironment('e2e-manage-policies-add');
    await env.setup();
    const { code, stderr } = await env.init();
    if (code !== 0) throw new Error(`Init failed: ${stderr}`);
  });

  afterAll(() => env.teardown(), 30000);

  it('should fail if missing required arguments', async () => {
    const { stderr, code } = await env.runBin(binPath, ['add']);
    expect(code).toBe(1);
    expect(stderr).toContain("error: required option '--name <policy_name>' not specified");
  });

  it('should fail if policy name is invalid', async () => {
    const { stderr, code } = await env.runBin(binPath, [
      'add',
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
      'add',
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
      'add',
      '--name',
      'echo-test',
      '--description',
      'A simple echo command',
      '--command',
      'echo "Hello World"',
    ]);

    if (code !== 0) console.error(stderr);
    expect(code).toBe(0);
    expect(stdout).toContain("Successfully added policy 'echo-test'");

    const policiesPath = path.resolve(env.e2eDir, '.clawmini/policies.json');
    const policies = JSON.parse(fs.readFileSync(policiesPath, 'utf8'));

    expect(policies.policies['echo-test']).toBeDefined();
    expect(policies.policies['echo-test'].description).toBe('A simple echo command');
    expect(policies.policies['echo-test'].command).toBe('echo');
    expect(policies.policies['echo-test'].args).toEqual(['Hello World']);
    expect(policies.policies['echo-test'].allowHelp).toBe(false);
    expect(policies.policies['echo-test'].autoApprove).toBe(false);
  });

  it('should set autoApprove and allowHelp when dangerous flags are passed', async () => {
    const { stdout, stderr, code } = await env.runBin(binPath, [
      'add',
      '--name',
      'dangerous-echo',
      '--description',
      'Echo with both dangerous opt-ins',
      '--command',
      'echo dangerous',
      '--dangerously-auto-approve',
      '--dangerously-allow-help',
    ]);

    if (code !== 0) console.error(stderr);
    expect(code).toBe(0);
    expect(stdout).toContain("Successfully added policy 'dangerous-echo'");

    const policiesPath = path.resolve(env.e2eDir, '.clawmini/policies.json');
    const policies = JSON.parse(fs.readFileSync(policiesPath, 'utf8'));

    expect(policies.policies['dangerous-echo'].allowHelp).toBe(true);
    expect(policies.policies['dangerous-echo'].autoApprove).toBe(true);
  });

  it('should set only autoApprove when only --dangerously-auto-approve is passed', async () => {
    const { code } = await env.runBin(binPath, [
      'add',
      '--name',
      'auto-only',
      '--description',
      'Auto-approve only',
      '--command',
      'echo auto',
      '--dangerously-auto-approve',
    ]);
    expect(code).toBe(0);

    const policiesPath = path.resolve(env.e2eDir, '.clawmini/policies.json');
    const policies = JSON.parse(fs.readFileSync(policiesPath, 'utf8'));

    expect(policies.policies['auto-only'].autoApprove).toBe(true);
    expect(policies.policies['auto-only'].allowHelp).toBe(false);
  });

  it('should set only allowHelp when only --dangerously-allow-help is passed', async () => {
    const { code } = await env.runBin(binPath, [
      'add',
      '--name',
      'help-only',
      '--description',
      'Allow help only',
      '--command',
      'echo help',
      '--dangerously-allow-help',
    ]);
    expect(code).toBe(0);

    const policiesPath = path.resolve(env.e2eDir, '.clawmini/policies.json');
    const policies = JSON.parse(fs.readFileSync(policiesPath, 'utf8'));

    expect(policies.policies['help-only'].allowHelp).toBe(true);
    expect(policies.policies['help-only'].autoApprove).toBe(false);
  });

  it('should create a policy with a script file', async () => {
    const scriptPath = path.resolve(env.e2eDir, 'test-script.sh');
    fs.writeFileSync(scriptPath, '#!/bin/bash\necho "From script"', { mode: 0o755 });

    const { stdout, code } = await env.runBin(binPath, [
      'add',
      '--name',
      'script-test',
      '--description',
      'A test script policy',
      '--script-file',
      scriptPath,
    ]);

    expect(code).toBe(0);
    expect(stdout).toContain("Successfully added policy 'script-test'");

    const destScriptPath = path.resolve(env.e2eDir, '.clawmini/policy-scripts/script-test.sh');
    expect(fs.existsSync(destScriptPath)).toBe(true);

    const policiesPath = path.resolve(env.e2eDir, '.clawmini/policies.json');
    const policies = JSON.parse(fs.readFileSync(policiesPath, 'utf8'));

    expect(policies.policies['script-test']).toBeDefined();
    expect(policies.policies['script-test'].command).toBe(
      './.clawmini/policy-scripts/script-test.sh'
    );
  });

  it('should refuse to overwrite an existing policy with the same name', async () => {
    const { stderr, code } = await env.runBin(binPath, [
      'add',
      '--name',
      'echo-test',
      '--description',
      'An updated echo command',
      '--command',
      'echo "Updated"',
    ]);

    expect(code).toBe(1);
    expect(stderr).toContain(
      "Policy 'echo-test' is already registered. Use 'manage-policies update' to modify it"
    );

    const policiesPath = path.resolve(env.e2eDir, '.clawmini/policies.json');
    const policies = JSON.parse(fs.readFileSync(policiesPath, 'utf8'));
    expect(policies.policies['echo-test'].description).toBe('A simple echo command');
  });
});

describe('manage-policies update', () => {
  let env: TestEnvironment;

  beforeAll(async () => {
    env = new TestEnvironment('e2e-manage-policies-update');
    await env.setup();
    const { code, stderr } = await env.init();
    if (code !== 0) throw new Error(`Init failed: ${stderr}`);

    const { code: addCode, stderr: addStderr } = await env.runBin(binPath, [
      'add',
      '--name',
      'echo-test',
      '--description',
      'A simple echo command',
      '--command',
      'echo "Hello"',
    ]);
    if (addCode !== 0) throw new Error(`Seed failed: ${addStderr}`);
  });

  afterAll(() => env.teardown(), 30000);

  it('should fail if policy does not exist', async () => {
    const { stderr, code } = await env.runBin(binPath, [
      'update',
      '--name',
      'nonexistent',
      '--description',
      'whatever',
    ]);
    expect(code).toBe(1);
    expect(stderr).toContain(
      "No user-registered policy 'nonexistent' to update. Use 'manage-policies add'"
    );
  });

  it('should explain the recovery path when updating a disabled policy', async () => {
    // Manually mark a policy as disabled (`false`) so we exercise that branch
    // without depending on remove/add ordering inside this suite.
    const policiesPath = path.resolve(env.e2eDir, '.clawmini/policies.json');
    const policies = JSON.parse(fs.readFileSync(policiesPath, 'utf8'));
    policies.policies['disabled-thing'] = false;
    fs.writeFileSync(policiesPath, JSON.stringify(policies, null, 2));

    const { stderr, code } = await env.runBin(binPath, [
      'update',
      '--name',
      'disabled-thing',
      '--description',
      'whatever',
    ]);
    expect(code).toBe(1);
    expect(stderr).toContain(
      "Policy 'disabled-thing' is currently disabled. Run 'manage-policies remove --name disabled-thing'"
    );

    // Cleanup so later tests in this suite see a clean slate.
    delete policies.policies['disabled-thing'];
    fs.writeFileSync(policiesPath, JSON.stringify(policies, null, 2));
  });

  it('should fail if no fields are specified to update', async () => {
    const { stderr, code } = await env.runBin(binPath, [
      'update',
      '--name',
      'echo-test',
    ]);
    expect(code).toBe(1);
    expect(stderr).toContain('No fields specified to update.');
  });

  it('should update only the description by default', async () => {
    const { stdout, code } = await env.runBin(binPath, [
      'update',
      '--name',
      'echo-test',
      '--description',
      'Updated description',
    ]);
    expect(code).toBe(0);
    expect(stdout).toContain("Successfully updated policy 'echo-test'");

    const policiesPath = path.resolve(env.e2eDir, '.clawmini/policies.json');
    const policies = JSON.parse(fs.readFileSync(policiesPath, 'utf8'));
    expect(policies.policies['echo-test'].description).toBe('Updated description');
    expect(policies.policies['echo-test'].command).toBe('echo');
    expect(policies.policies['echo-test'].args).toEqual(['Hello']);
  });

  it('should replace the command and clear stale args', async () => {
    const { code } = await env.runBin(binPath, [
      'update',
      '--name',
      'echo-test',
      '--command',
      'date',
    ]);
    expect(code).toBe(0);

    const policiesPath = path.resolve(env.e2eDir, '.clawmini/policies.json');
    const policies = JSON.parse(fs.readFileSync(policiesPath, 'utf8'));
    expect(policies.policies['echo-test'].command).toBe('date');
    expect(policies.policies['echo-test'].args).toBeUndefined();
  });

  it('should enable the dangerous flags via bare flags', async () => {
    const { code } = await env.runBin(binPath, [
      'update',
      '--name',
      'echo-test',
      '--dangerously-auto-approve',
      '--dangerously-allow-help',
    ]);
    expect(code).toBe(0);

    const policiesPath = path.resolve(env.e2eDir, '.clawmini/policies.json');
    const policies = JSON.parse(fs.readFileSync(policiesPath, 'utf8'));
    expect(policies.policies['echo-test'].autoApprove).toBe(true);
    expect(policies.policies['echo-test'].allowHelp).toBe(true);
  });

  it('should disable a dangerous flag via the --no- negation', async () => {
    const { code } = await env.runBin(binPath, [
      'update',
      '--name',
      'echo-test',
      '--no-dangerously-auto-approve',
    ]);
    expect(code).toBe(0);

    const policiesPath = path.resolve(env.e2eDir, '.clawmini/policies.json');
    const policies = JSON.parse(fs.readFileSync(policiesPath, 'utf8'));
    expect(policies.policies['echo-test'].autoApprove).toBe(false);
    // The other flag stays as it was — we only touched auto-approve.
    expect(policies.policies['echo-test'].allowHelp).toBe(true);
  });

  it('should unlink the prior script when --script-file changes the extension', async () => {
    // Seed a policy backed by a .sh script.
    const shSrc = path.resolve(env.e2eDir, 'extension-test.sh');
    fs.writeFileSync(shSrc, '#!/bin/bash\necho sh\n', { mode: 0o755 });
    const { code: addCode } = await env.runBin(binPath, [
      'add',
      '--name',
      'ext-policy',
      '--description',
      'extension test',
      '--script-file',
      shSrc,
    ]);
    expect(addCode).toBe(0);

    const oldScript = path.resolve(
      env.e2eDir,
      '.clawmini/policy-scripts/ext-policy.sh'
    );
    expect(fs.existsSync(oldScript)).toBe(true);

    // Replace with a .py script of the same policy name; the extension
    // changes, so the old .sh would otherwise be orphaned.
    const pySrc = path.resolve(env.e2eDir, 'extension-test.py');
    fs.writeFileSync(pySrc, '#!/usr/bin/env python3\nprint("py")\n', { mode: 0o755 });
    const { code: updateCode } = await env.runBin(binPath, [
      'update',
      '--name',
      'ext-policy',
      '--script-file',
      pySrc,
    ]);
    expect(updateCode).toBe(0);

    const newScript = path.resolve(
      env.e2eDir,
      '.clawmini/policy-scripts/ext-policy.py'
    );
    expect(fs.existsSync(newScript)).toBe(true);
    expect(fs.existsSync(oldScript)).toBe(false);

    const policiesPath = path.resolve(env.e2eDir, '.clawmini/policies.json');
    const policies = JSON.parse(fs.readFileSync(policiesPath, 'utf8'));
    expect(policies.policies['ext-policy'].command).toBe(
      './.clawmini/policy-scripts/ext-policy.py'
    );
  });

  it('should unlink the prior script when --command replaces a script policy', async () => {
    // The previous test left ext-policy backed by ext-policy.py.
    const pyScript = path.resolve(
      env.e2eDir,
      '.clawmini/policy-scripts/ext-policy.py'
    );
    expect(fs.existsSync(pyScript)).toBe(true);

    const { code } = await env.runBin(binPath, [
      'update',
      '--name',
      'ext-policy',
      '--command',
      'echo plain',
    ]);
    expect(code).toBe(0);

    expect(fs.existsSync(pyScript)).toBe(false);

    const policiesPath = path.resolve(env.e2eDir, '.clawmini/policies.json');
    const policies = JSON.parse(fs.readFileSync(policiesPath, 'utf8'));
    expect(policies.policies['ext-policy'].command).toBe('echo');
    expect(policies.policies['ext-policy'].args).toEqual(['plain']);
  });
});

describe('manage-policies remove', () => {
  let env: TestEnvironment;

  beforeAll(async () => {
    env = new TestEnvironment('e2e-manage-policies-remove');
    await env.setup();
    const { code, stderr } = await env.init();
    if (code !== 0) throw new Error(`Init failed: ${stderr}`);

    const { code: addCode } = await env.runBin(binPath, [
      'add',
      '--name',
      'doomed',
      '--description',
      'will be removed',
      '--command',
      'echo gone',
    ]);
    if (addCode !== 0) throw new Error('Seed failed');
  });

  afterAll(() => env.teardown(), 30000);

  it('should remove an existing user policy', async () => {
    const { stdout, code } = await env.runBin(binPath, ['remove', '--name', 'doomed']);
    expect(code).toBe(0);
    expect(stdout).toContain("Successfully removed policy 'doomed'");

    const policiesPath = path.resolve(env.e2eDir, '.clawmini/policies.json');
    const policies = JSON.parse(fs.readFileSync(policiesPath, 'utf8'));
    expect(policies.policies['doomed']).toBeUndefined();
  });

  it('should fail when removing a missing policy', async () => {
    const { stderr, code } = await env.runBin(binPath, ['remove', '--name', 'doomed']);
    expect(code).toBe(1);
    expect(stderr).toContain("No policy entry 'doomed' to remove.");
  });

  it('should hint at --disable-builtin when removing an unregistered built-in', async () => {
    const { stderr, code } = await env.runBin(binPath, [
      'remove',
      '--name',
      'manage-policies',
    ]);
    expect(code).toBe(1);
    expect(stderr).toContain(
      "'manage-policies' is a built-in. To opt out, re-run with --disable-builtin."
    );
  });

  it('should disable a built-in policy with --disable-builtin', async () => {
    const { stdout, code } = await env.runBin(binPath, [
      'remove',
      '--name',
      'manage-policies',
      '--disable-builtin',
    ]);
    expect(code).toBe(0);
    expect(stdout).toContain("Successfully disabled built-in policy 'manage-policies'");

    const policiesPath = path.resolve(env.e2eDir, '.clawmini/policies.json');
    const policies = JSON.parse(fs.readFileSync(policiesPath, 'utf8'));
    expect(policies.policies['manage-policies']).toBe(false);
  });

  it('should refuse --disable-builtin for non-builtin names', async () => {
    const { stderr, code } = await env.runBin(binPath, [
      'remove',
      '--name',
      'not-a-builtin',
      '--disable-builtin',
    ]);
    expect(code).toBe(1);
    expect(stderr).toContain(
      "--disable-builtin can only be used for built-in policies; 'not-a-builtin' is not a built-in."
    );
  });

  it('should clear a previous false entry by removing without --disable-builtin', async () => {
    const { stdout, code } = await env.runBin(binPath, [
      'remove',
      '--name',
      'manage-policies',
    ]);
    expect(code).toBe(0);
    expect(stdout).toContain(
      "Successfully cleared the disable entry for 'manage-policies'"
    );

    const policiesPath = path.resolve(env.e2eDir, '.clawmini/policies.json');
    const policies = JSON.parse(fs.readFileSync(policiesPath, 'utf8'));
    expect(policies.policies['manage-policies']).toBeUndefined();
  });

  it('should refuse --disable-builtin when a user override exists', async () => {
    // Register a user override of the built-in `manage-policies` first.
    const { code: addCode } = await env.runBin(binPath, [
      'add',
      '--name',
      'manage-policies',
      '--description',
      'override',
      '--command',
      'echo override',
    ]);
    expect(addCode).toBe(0);

    const { stderr, code } = await env.runBin(binPath, [
      'remove',
      '--name',
      'manage-policies',
      '--disable-builtin',
    ]);
    expect(code).toBe(1);
    expect(stderr).toContain(
      "Policy 'manage-policies' has a user override that would be lost. Run 'manage-policies remove --name manage-policies' first"
    );

    // The override must be intact — the failed --disable-builtin must not
    // have replaced it with `false`.
    const policiesPath = path.resolve(env.e2eDir, '.clawmini/policies.json');
    const policies = JSON.parse(fs.readFileSync(policiesPath, 'utf8'));
    expect(policies.policies['manage-policies']).toMatchObject({
      command: 'echo',
      args: ['override'],
    });
  });
});

describe('manage-policies CLI (uninitialized)', () => {
  let env: TestEnvironment;

  beforeAll(async () => {
    env = new TestEnvironment('e2e-manage-policies-uninit');
    await env.setup();
  });

  afterAll(() => env.teardown(), 30000);

  it('should fail if .clawmini directory does not exist', async () => {
    const { stderr, code } = await env.runBin(binPath, [
      'add',
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
