import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { TestEnvironment } from '../_helpers/test-environment.js';

describe('clawmini up auto-creates policies.json', () => {
  let env: TestEnvironment;

  beforeAll(async () => {
    env = new TestEnvironment('e2e-auto-create-policies');
    await env.setup();
    // Intentionally omit `policies` so no policies.json is pre-written.
    await env.setupSubagentEnv();
  }, 30000);

  afterAll(() => env.teardown(), 30000);

  it('creates an empty policies.json during up', () => {
    const policiesPath = path.resolve(env.e2eDir, '.clawmini/policies.json');
    expect(fs.existsSync(policiesPath)).toBe(true);
    expect(JSON.parse(fs.readFileSync(policiesPath, 'utf8'))).toEqual({ policies: {} });
  });

  it('exposes the built-in run-host policy even though the user never wrote policies.json', async () => {
    const { stdout, code } = await env.runLite(['requests', 'list']);
    expect(code).toBe(0);
    expect(stdout).toContain('- run-host');
  }, 30000);

  it('allows --help on run-host via lite without approval', async () => {
    const { stdout, code } = await env.runLite(['request', 'run-host', '--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('--command');
  }, 30000);
});
