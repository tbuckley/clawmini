import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { TestEnvironment } from '../_helpers/test-environment.js';

describe('E2E `requests show` script size handling', () => {
  let env: TestEnvironment;
  let agentDir = '';

  beforeAll(async () => {
    env = new TestEnvironment('e2e-tmp-requests-show');
    await env.setup();
    await env.setupSubagentEnv({
      policies: {
        'small-script': {
          description: 'A small inline-able script',
          command: './.clawmini/policy-scripts/small-script.sh',
        },
        'large-script': {
          description: 'A large script that should spill to tmp',
          command: './.clawmini/policy-scripts/large-script.sh',
        },
        'system-cmd': {
          description: 'A system command (no script body)',
          command: 'echo',
          args: ['hi'],
        },
        'symlink-escape': {
          description: 'A symlink in policy-scripts/ pointing outside it',
          command: './.clawmini/policy-scripts/symlink-escape.sh',
        },
      },
    });

    const scriptsDir = env.getClawminiPath('policy-scripts');
    fs.mkdirSync(scriptsDir, { recursive: true });
    fs.writeFileSync(
      path.join(scriptsDir, 'small-script.sh'),
      '#!/bin/sh\necho hello-from-small\n',
      { mode: 0o755 }
    );
    // 5000 chars > MAX_INLINE_SCRIPT_LENGTH (4000), forcing the spill path.
    fs.writeFileSync(
      path.join(scriptsDir, 'large-script.sh'),
      '#!/bin/sh\n' + 'x'.repeat(5000) + '\n',
      { mode: 0o755 }
    );

    // Plant a sensitive file outside policy-scripts/, then a symlink inside
    // policy-scripts/ pointing at it. The endpoint must refuse to read the
    // symlink target — string-prefix containment alone would allow this.
    const sensitive = path.resolve(env.e2eDir, 'outside-sensitive.txt');
    fs.writeFileSync(sensitive, 'top secret\n');
    fs.symlinkSync(sensitive, path.join(scriptsDir, 'symlink-escape.sh'));

    agentDir = path.resolve(env.e2eDir, 'debug-agent');
    await env.getAgentCredentials();
  }, 30000);

  afterAll(() => env.teardown(), 30000);

  const runLite = (args: string[]) => env.runLite(args, { cwd: agentDir });

  it('shows a small script body inline', async () => {
    const { stdout, stderr, code } = await runLite(['requests', 'show', 'small-script']);

    expect(stderr).toBe('');
    expect(code).toBe(0);
    expect(stdout).toContain('"description": "A small inline-able script"');
    expect(stdout).toContain('--- Script:');
    expect(stdout).toContain('hello-from-small');
    expect(stdout).not.toContain('copied to ./tmp/');
  });

  it('spills a large script to the agent tmp dir instead of inlining', async () => {
    const { stdout, stderr, code } = await runLite(['requests', 'show', 'large-script']);

    expect(stderr).toBe('');
    expect(code).toBe(0);
    expect(stdout).toContain('--- Script:');
    expect(stdout).toContain('copied to ./tmp/policy-script-large-script.sh');
    // The huge body must not be inlined.
    expect(stdout).not.toContain('x'.repeat(100));

    const spillPath = path.join(agentDir, 'tmp', 'policy-script-large-script.sh');
    expect(fs.existsSync(spillPath)).toBe(true);
    const spilled = fs.readFileSync(spillPath, 'utf8');
    expect(spilled).toContain('x'.repeat(5000));
    expect(spilled.startsWith('#!/bin/sh')).toBe(true);
  });

  it('overwrites the same spill file when shown again', async () => {
    const spillPath = path.join(agentDir, 'tmp', 'policy-script-large-script.sh');
    const before = fs.statSync(spillPath).size;

    // Update the source script to a different (still-large) body.
    const scriptPath = env.getClawminiPath('policy-scripts', 'large-script.sh');
    fs.writeFileSync(scriptPath, '#!/bin/sh\n' + 'y'.repeat(6000) + '\n', { mode: 0o755 });

    const { code } = await runLite(['requests', 'show', 'large-script']);
    expect(code).toBe(0);

    const after = fs.readFileSync(spillPath, 'utf8');
    expect(after).toContain('y'.repeat(6000));
    expect(after).not.toContain('x'.repeat(100));
    expect(fs.statSync(spillPath).size).not.toBe(before);
  });

  it('prints JSON only with no script body for system-command policies', async () => {
    const { stdout, stderr, code } = await runLite(['requests', 'show', 'system-cmd']);

    expect(stderr).toBe('');
    expect(code).toBe(0);
    expect(stdout).toContain('"command": "echo"');
    expect(stdout).toContain('(no script body:');
    expect(stdout).not.toContain('--- Script:');
  });

  it('refuses to read a symlink in policy-scripts/ that points outside', async () => {
    const { stdout, stderr, code } = await runLite([
      'requests',
      'show',
      'symlink-escape',
    ]);

    expect(stderr).toBe('');
    expect(code).toBe(0);
    // The body itself must never appear, regardless of what error path the
    // endpoint takes.
    expect(stdout).not.toContain('top secret');
    // The CLI surfaces BAD_REQUEST as a "(no script body: ...)" hint.
    expect(stdout).toContain('(no script body:');
    expect(stdout).toContain('does not point at a script in policy-scripts/');
  });
});
