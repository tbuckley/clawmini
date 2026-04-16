import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TestEnvironment } from '../_helpers/test-environment.js';

describe('E2E Skills Tests', () => {
  let env: TestEnvironment;

  beforeAll(async () => {
    env = new TestEnvironment('e2e-tmp-skills');
    await env.setup();
    await env.runCli(['init', '--agent', 'test-agent']);
  }, 30000);

  afterAll(() => env.teardown(), 30000);

  it('should list available template skills', async () => {
    const { stdout, code, stderr } = await env.runCli(['skills', 'list']);
    expect(code).toBe(0);
    // As it reads from the internal templates/skills directory,
    // it should at least output one of the default template skills, or "No skills found."
    // Let's just ensure it executes successfully.
    expect(stderr).toBe('');
    expect(stdout.length).toBeGreaterThan(0);
  });

  it('should add a specific skill', async () => {
    const { stdout, code, stderr } = await env.runCli([
      'skills',
      'add',
      'skill-creator',
      '--agent',
      'test-agent',
    ]);
    expect(stderr).toBe('');
    expect(code).toBe(0);
    expect(stdout).toContain("Successfully added skill 'skill-creator'");
  });

  it('should add all skills when no skill name is provided', async () => {
    const { stdout, code, stderr } = await env.runCli(['skills', 'add', '--agent', 'test-agent']);
    expect(stderr).toBe('');
    expect(code).toBe(0);
    expect(stdout).toContain('Successfully added all skills to agent');
  });

  it('should handle adding an invalid skill gracefully', async () => {
    const { code, stderr } = await env.runCli([
      'skills',
      'add',
      'invalid-skill-name-123',
      '--agent',
      'test-agent',
    ]);
    expect(code).not.toBe(0);
    expect(stderr).toContain('Failed to add skill:');
  });
});
