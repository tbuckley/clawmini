import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { TestEnvironment } from '../_helpers/test-environment.js';

// Regression test: policies whose `command` is a relative path (e.g. the
// built-in run-host uses `./.clawmini/policy-scripts/run-host.js`) must run
// successfully even when the triggering agent's cwd is somewhere other than
// the workspace root. resolvePolicies now resolves relative paths against the
// workspace root so spawn no longer depends on the caller's cwd.
describe('Policy with relative script path', () => {
  let env: TestEnvironment;

  beforeAll(async () => {
    env = new TestEnvironment('e2e-policy-relative-path');
    await env.setup();
    await env.setupSubagentEnv();

    const scriptRelDir = 'tools';
    const scriptRelPath = `./${scriptRelDir}/relative-policy.sh`;
    const scriptAbsDir = path.resolve(env.e2eDir, scriptRelDir);
    const scriptAbsPath = path.resolve(env.e2eDir, scriptRelPath);

    fs.mkdirSync(scriptAbsDir, { recursive: true });
    fs.writeFileSync(
      scriptAbsPath,
      '#!/bin/sh\necho "arg: $1"\n',
      { mode: 0o755 }
    );

    // autoApprove:true executes the policy directly from
    // agent-policy-endpoints.createPolicyRequest, where hostCwd is resolved
    // from the requesting agent's directory — making this path diverge from
    // the workspace root even for the default configuration.
    env.writePolicies({
      'relative-policy': {
        description: 'Policy whose command is a relative path from the workspace root',
        command: scriptRelPath,
        autoApprove: true,
      },
    });
  }, 30000);

  afterAll(() => env.teardown(), 30000);

  it('runs the script regardless of the requesting agent cwd', async () => {
    // The debug-agent runs commands in its own work dir (<workspaceRoot>/debug-agent),
    // so a relative `command` of `./tools/relative-policy.sh` would resolve
    // against that subdirectory without the fix — which does not contain the
    // script. runLite proxies through the debug-agent's CLAW_API_URL/TOKEN so
    // the request is created with that agent's identity.
    const { stdout, code } = await env.runLite(
      ['request', 'relative-policy', '--', 'hello'],
      { cwd: path.resolve(env.e2eDir, 'debug-agent') }
    );

    expect(code).toBe(0);
    expect(stdout).toContain('arg: hello');
  }, 30000);
});
