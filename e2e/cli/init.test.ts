import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { TestEnvironment } from '../_helpers/test-environment.js';

describe('initCmd with flags', () => {
  let env: TestEnvironment;

  beforeAll(async () => {
    env = new TestEnvironment('e2e-tmp-init');
    await env.setup();
  }, 30000);

  afterAll(() => env.teardown(), 30000);

  it('should fail if --agent-template is provided without --agent', async () => {
    const { stderr, code } = await env.runCli(['init', '--agent-template', 'bob']);
    expect(code).toBe(1);
    expect(stderr).toContain('--agent-template cannot be used without --agent');
  });

  it('should fail with invalid agent id', async () => {
    const { stderr, code } = await env.runCli(['init', '--agent', 'invalid/id']);
    expect(code).toBe(1);
    expect(stderr).toContain('Invalid agent ID');
  });

  it('should run init, create agent, and set default chat', async () => {
    const { stdout, stderr, code } = await env.runCli(['init', '--agent', 'test-agent']);

    expect(stderr).toBe('');
    expect(code).toBe(0);
    expect(stdout).toContain('Initialized .clawmini/settings.json');
    expect(stdout).toContain('Agent test-agent created successfully');
    expect(stdout).toContain('Default chat set to test-agent');

    expect(fs.existsSync(env.getClawminiPath('settings.json'))).toBe(true);

    const settings = env.getSettings();
    expect((settings.chats as Record<string, unknown> | undefined)?.defaultId).toBe('test-agent');

    expect(fs.existsSync(env.getAgentPath('test-agent', 'settings.json'))).toBe(true);
    expect(fs.existsSync(env.getChatPath('test-agent', 'settings.json'))).toBe(true);

    // Verify skills were copied to the agent's default skills directory (.agents/skills)
    const skillsDir = path.join(env.e2eDir, 'test-agent', '.agents', 'skills');
    expect(fs.existsSync(skillsDir)).toBe(true);
    // Check for at least one skill inside
    const skillsList = fs.readdirSync(skillsDir);
    expect(skillsList.length).toBeGreaterThan(0);
  });

  it.skip('should run init and enable an environment', async () => {
    const clawminiDir = env.getClawminiPath();
    if (fs.existsSync(clawminiDir)) {
      fs.rmSync(clawminiDir, { recursive: true, force: true });
    }

    const { stdout, stderr, code } = await env.runCli(['init', '--environment', 'macos']);

    expect(stderr).toBe('');
    expect(code).toBe(0);
    expect(stdout).toContain('Initialized .clawmini/settings.json');
    expect(stdout).toContain("Copied environment template 'macos'");
    expect(stdout).toContain("Enabled environment 'macos' for path './'");

    expect(fs.existsSync(env.getClawminiPath('settings.json'))).toBe(true);

    const settings = env.getSettings();
    expect(
      (settings.environments as Record<string, unknown> | undefined)?.['./']
    ).toBe('macos');

    expect(fs.existsSync(env.getClawminiPath('environments', 'macos'))).toBe(true);
  });
});
