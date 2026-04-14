import { TestEnvironment } from './test-environment.js';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('TestEnvironment', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = new TestEnvironment('test-env');
  });

  afterEach(async () => {
    await env.teardown();
  });

  it('generates a unique id and creates an e2e directory', () => {
    expect(env.id).toMatch(/^test-env-\d+-\d+$/);
    expect(env.e2eDir).toContain(`clawmini-${env.id}`);
  });

  it('setup creates directory and init git', async () => {
    await env.setup();
    expect(fs.existsSync(env.e2eDir)).toBe(true);
    expect(fs.existsSync(path.join(env.e2eDir, '.git'))).toBe(true);
  });

  it('updates settings', async () => {
    await env.setup();
    fs.mkdirSync(path.join(env.e2eDir, '.clawmini'), { recursive: true });

    env.updateSettings({ api: { port: 8080 } });

    const settingsPath = path.join(env.e2eDir, '.clawmini', 'settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));

    expect(settings.api.port).toBe(8080);
  });

  it('writes policies', async () => {
    await env.setup();
    env.writePolicies([{ name: 'test-policy' }]);

    const policiesPath = path.join(env.e2eDir, '.clawmini', 'policies.json');
    expect(fs.existsSync(policiesPath)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(policiesPath, 'utf8'));
    expect(parsed.policies[0].name).toBe('test-policy');
  });
});
