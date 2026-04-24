import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { TestEnvironment } from '../_helpers/test-environment.js';
import { getAgent } from '../../src/shared/workspace.js';

describe('E2E Agents Tests', () => {
  let env: TestEnvironment;

  beforeAll(async () => {
    env = new TestEnvironment('e2e-tmp-agents');
    await env.setup();
    await env.init();
  }, 30000);

  afterAll(() => env.teardown(), 30000);

  it('should create, list, update and delete agents', async () => {
    const { stdout: stdoutAdd, code: codeAdd } = await env.runCli([
      'agents',
      'add',
      'test-agent',
      '--directory',
      './test-agent-dir',
      '--env',
      'FOO=BAR',
      '--env',
      'BAZ=QUX',
    ]);
    expect(codeAdd).toBe(0);
    expect(stdoutAdd).toContain('Agent test-agent created successfully.');

    expect(fs.existsSync(env.getChatPath('test-agent', 'settings.json'))).toBe(true);
    const chatData = env.getChatSettings('test-agent');
    expect(chatData.defaultAgent).toBe('test-agent');

    const agentSettingsPath = env.getAgentPath('test-agent', 'settings.json');
    expect(fs.existsSync(agentSettingsPath)).toBe(true);
    const agentData = env.getAgentSettings('test-agent');
    const agentEnv = agentData.env as Record<string, string> | undefined;
    expect(agentData.directory).toBe('./test-agent-dir');
    expect(agentEnv?.FOO).toBe('BAR');
    expect(agentEnv?.BAZ).toBe('QUX');

    const { stdout: stdoutList1 } = await env.runCli(['agents', 'list']);
    expect(stdoutList1).toContain('- test-agent');

    const { stdout: stdoutUpdate, code: codeUpdate } = await env.runCli([
      'agents',
      'update',
      'test-agent',
      '--directory',
      './new-dir',
      '--env',
      'FOO=NEW_BAR',
    ]);
    expect(codeUpdate).toBe(0);
    expect(stdoutUpdate).toContain('Agent test-agent updated successfully.');

    const updatedAgentData = env.getAgentSettings('test-agent');
    const updatedEnv = updatedAgentData.env as Record<string, string> | undefined;
    expect(updatedAgentData.directory).toBe('./new-dir');
    expect(updatedEnv?.FOO).toBe('NEW_BAR');
    expect(updatedEnv?.BAZ).toBe('QUX');

    const { stdout: stdoutDelete, code: codeDelete } = await env.runCli([
      'agents',
      'delete',
      'test-agent',
    ]);
    expect(codeDelete).toBe(0);
    expect(stdoutDelete).toContain('Agent test-agent deleted successfully.');
    expect(fs.existsSync(agentSettingsPath)).toBe(false);
  });

  it('should output a warning if chat already exists when adding an agent', async () => {
    // First, manually create a chat directory
    fs.mkdirSync(env.getChatPath('existing-chat'), { recursive: true });

    const { stdout, stderr, code } = await env.addAgent('existing-chat');

    expect(code).toBe(0);
    expect(stderr).toContain('Warning: Chat existing-chat already exists.');
    expect(stdout).toContain('Agent existing-chat created successfully.');
  });

  it('should create an agent using a template (overlay shape by default)', async () => {
    // Create a local template
    const templateDir = env.getClawminiPath('templates', 'test-template');
    fs.mkdirSync(templateDir, { recursive: true });

    // Create some template files
    fs.writeFileSync(path.join(templateDir, 'hello.txt'), 'Hello Template!');

    const templateSettings = {
      directory: './should-be-ignored',
      env: {
        TEMPLATE_VAR: 'template_value',
        FOO: 'WILL_BE_OVERRIDDEN',
      },
    };
    fs.writeFileSync(path.join(templateDir, 'settings.json'), JSON.stringify(templateSettings));

    const { stdout, code } = await env.runCli([
      'agents',
      'add',
      'test-template-agent',
      '--template',
      'test-template',
      '--directory',
      './custom-agent-dir',
      '--env',
      'FOO=BAR',
    ]);

    expect(code).toBe(0);
    expect(stdout).toContain('Agent test-template-agent created successfully.');
    expect(fs.existsSync(env.getAgentPath('test-template-agent', 'settings.json'))).toBe(true);

    // Overlay: only the user-supplied fields + `extends`; template fields
    // are not merged in on disk.
    const overlay = env.getAgentSettings('test-template-agent');
    expect(overlay.extends).toBe('test-template');
    expect(overlay.directory).toBe('./custom-agent-dir');
    expect((overlay.env as Record<string, string>).FOO).toBe('BAR');

    // Resolved view (template merged): both TEMPLATE_VAR and FOO are present.
    const resolved = await getAgent('test-template-agent', env.e2eDir);
    expect(resolved?.directory).toBe('./custom-agent-dir');
    const resolvedEnv = resolved?.env as Record<string, string> | undefined;
    expect(resolvedEnv?.TEMPLATE_VAR).toBe('template_value');
    expect(resolvedEnv?.FOO).toBe('BAR');

    // Template files copied; settings.json stripped from the workdir.
    const customDir = path.resolve(env.e2eDir, 'custom-agent-dir');
    expect(fs.existsSync(path.join(customDir, 'hello.txt'))).toBe(true);
    expect(fs.existsSync(path.join(customDir, 'settings.json'))).toBe(false);
  });

  it('should create a forked agent that merges template settings into the file', async () => {
    const templateDir = env.getClawminiPath('templates', 'fork-template');
    fs.mkdirSync(templateDir, { recursive: true });
    fs.writeFileSync(path.join(templateDir, 'hello.txt'), 'fork');
    fs.writeFileSync(
      path.join(templateDir, 'settings.json'),
      JSON.stringify({
        directory: './should-be-ignored',
        env: { TEMPLATE_VAR: 'template_value', FOO: 'WILL_BE_OVERRIDDEN' },
      })
    );

    const { stderr, code } = await env.runCli([
      'agents',
      'add',
      'forked-agent',
      '--template',
      'fork-template',
      '--fork',
      '--directory',
      './forked-dir',
      '--env',
      'FOO=BAR',
    ]);
    expect(code).toBe(0);
    // Fork mode still warns when the template's `directory` field is ignored.
    expect(stderr).toContain("Warning: Ignoring 'directory' field from template settings.json");

    const overlay = env.getAgentSettings('forked-agent');
    // No extends — fork mode inlines everything.
    expect(overlay.extends).toBeUndefined();
    expect(overlay.directory).toBe('./forked-dir');
    const overlayEnv = overlay.env as Record<string, string>;
    expect(overlayEnv.TEMPLATE_VAR).toBe('template_value');
    expect(overlayEnv.FOO).toBe('BAR');
  });
});
