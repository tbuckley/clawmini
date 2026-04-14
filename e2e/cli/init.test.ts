import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { createE2EContext } from '../_helpers/utils.js';

describe('initCmd with flags', () => {
  const { runCli, e2eDir, setupE2E, teardownE2E } = createE2EContext('e2e-tmp-init');

  beforeAll(setupE2E, 30000);
  afterAll(teardownE2E, 30000);

  it('should fail if --agent-template is provided without --agent', async () => {
    const { stderr, code } = await runCli(['init', '--agent-template', 'bob']);
    expect(code).toBe(1);
    expect(stderr).toContain('--agent-template cannot be used without --agent');
  });

  it('should fail with invalid agent id', async () => {
    const { stderr, code } = await runCli(['init', '--agent', 'invalid/id']);
    expect(code).toBe(1);
    expect(stderr).toContain('Invalid agent ID');
  });

  it('should run init, create agent, and set default chat', async () => {
    const { stdout, stderr, code } = await runCli(['init', '--agent', 'test-agent']);

    expect(stderr).toBe('');
    expect(code).toBe(0);
    expect(stdout).toContain('Initialized .clawmini/settings.json');
    expect(stdout).toContain('Agent test-agent created successfully');
    expect(stdout).toContain('Default chat set to test-agent');

    const clawminiDir = path.resolve(e2eDir, '.clawmini');
    const settingsPath = path.join(clawminiDir, 'settings.json');
    expect(fs.existsSync(settingsPath)).toBe(true);

    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    expect(settings.chats?.defaultId).toBe('test-agent');

    const agentSettingsPath = path.join(clawminiDir, 'agents', 'test-agent', 'settings.json');
    expect(fs.existsSync(agentSettingsPath)).toBe(true);

    const chatSettingsPath = path.join(clawminiDir, 'chats', 'test-agent', 'settings.json');
    expect(fs.existsSync(chatSettingsPath)).toBe(true);

    // Verify skills were copied to the agent's default skills directory (.agents/skills)
    const skillsDir = path.join(e2eDir, 'test-agent', '.agents', 'skills');
    expect(fs.existsSync(skillsDir)).toBe(true);
    // Check for at least one skill inside
    const skillsList = fs.readdirSync(skillsDir);
    expect(skillsList.length).toBeGreaterThan(0);
  });

  it.skip('should run init and enable an environment', async () => {
    const clawminiDir = path.resolve(e2eDir, '.clawmini');
    if (fs.existsSync(clawminiDir)) {
      fs.rmSync(clawminiDir, { recursive: true, force: true });
    }

    const { stdout, stderr, code } = await runCli(['init', '--environment', 'macos']);

    expect(stderr).toBe('');
    expect(code).toBe(0);
    expect(stdout).toContain('Initialized .clawmini/settings.json');
    expect(stdout).toContain("Copied environment template 'macos'");
    expect(stdout).toContain("Enabled environment 'macos' for path './'");

    const settingsPath = path.join(clawminiDir, 'settings.json');
    expect(fs.existsSync(settingsPath)).toBe(true);

    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    expect(settings.environments?.['./']).toBe('macos');

    const envDir = path.join(clawminiDir, 'environments', 'macos');
    expect(fs.existsSync(envDir)).toBe(true);
  });
});
