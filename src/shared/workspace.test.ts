import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getWorkspaceRoot,
  getChatSettingsPath,
  getAgentSessionSettingsPath,
  readChatSettings,
  writeChatSettings,
  readAgentSessionSettings,
  writeAgentSessionSettings,
  isValidAgentId,
  getAgentDir,
  getAgentSettingsPath,
  getAgent,
  writeAgentSettings,
  listAgents,
  deleteAgent,
  resolveTemplatePath,
  copyTemplate,
  readSettings,
  writeSettings,
  readEnvironment,
  getActiveEnvironmentName,
  resolveTargetAgentSkillsDir,
  resolvePolicies,
} from './workspace.js';
import type { Agent, Settings, Environment } from './config.js';
import { BUILTIN_POLICIES } from './policies.js';

describe('workspace utilities', () => {
  const testDir = path.join(process.cwd(), '.clawmini-test-workspace');
  const clawminiDir = path.join(testDir, '.clawmini');

  beforeEach(async () => {
    await fsPromises.mkdir(clawminiDir, { recursive: true });
  });

  afterEach(async () => {
    if (fs.existsSync(testDir)) {
      await fsPromises.rm(testDir, { recursive: true, force: true });
    }
  });

  describe('path resolution', () => {
    it('should resolve workspace root to the directory containing .clawmini', () => {
      const startDir = path.join(testDir, 'some', 'deep', 'dir');
      fs.mkdirSync(startDir, { recursive: true });
      expect(getWorkspaceRoot(startDir)).toBe(testDir);
    });

    it('should return getChatSettingsPath correctly', () => {
      const p = getChatSettingsPath('test-chat', testDir);
      expect(p).toBe(path.join(clawminiDir, 'chats', 'test-chat', 'settings.json'));
    });

    it('should return getAgentSessionSettingsPath correctly', () => {
      const p = getAgentSessionSettingsPath('test-agent', 'test-session', testDir);
      expect(p).toBe(
        path.join(clawminiDir, 'agents', 'test-agent', 'sessions', 'test-session', 'settings.json')
      );
    });
  });

  describe('isValidAgentId', () => {
    it('should return true for valid IDs', () => {
      expect(isValidAgentId('my-agent')).toBe(true);
      expect(isValidAgentId('agent123')).toBe(true);
      expect(isValidAgentId('A_b-c')).toBe(true);
    });

    it('should return false for invalid IDs', () => {
      expect(isValidAgentId('')).toBe(false);
      expect(isValidAgentId('../my-agent')).toBe(false);
      expect(isValidAgentId('my/agent')).toBe(false);
      expect(isValidAgentId('my\\agent')).toBe(false);
    });
  });

  describe('getAgentDir & getAgentSettingsPath', () => {
    it('should throw on invalid agent ID', () => {
      expect(() => getAgentDir('../invalid', testDir)).toThrow('Invalid agent ID');
      expect(() => getAgentSettingsPath('../invalid', testDir)).toThrow('Invalid agent ID');
    });

    it('should return correct path for valid agent ID', () => {
      expect(getAgentDir('agent-1', testDir)).toBe(path.join(clawminiDir, 'agents', 'agent-1'));
      expect(getAgentSettingsPath('agent-1', testDir)).toBe(
        path.join(clawminiDir, 'agents', 'agent-1', 'settings.json')
      );
    });
  });

  describe('Chat Settings read/write', () => {
    it('should return null if chat settings do not exist', async () => {
      const settings = await readChatSettings('non-existent', testDir);
      expect(settings).toBeNull();
    });

    it('should write and read chat settings', async () => {
      const data = { defaultAgent: 'agent-1' };
      await writeChatSettings('chat-1', data, testDir);

      const p = getChatSettingsPath('chat-1', testDir);
      expect(fs.existsSync(p)).toBe(true);

      const settings = await readChatSettings('chat-1', testDir);
      expect(settings).toEqual(data);
    });

    it('should clean up locks after updateChatSettings (no memory leak)', async () => {
      const { chatSettingsLocks, updateChatSettings } = await import('./workspace.js');
      expect(chatSettingsLocks.size).toBe(0);

      await updateChatSettings('leak-chat', (settings) => settings, testDir);

      expect(chatSettingsLocks.size).toBe(0);
      expect(chatSettingsLocks.has('leak-chat')).toBe(false);
    });

    it('should return null if JSON is invalid', async () => {
      const p = getChatSettingsPath('chat-invalid', testDir);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, '{ invalid json', 'utf-8');

      const settings = await readChatSettings('chat-invalid', testDir);
      expect(settings).toBeNull();
    });
  });

  describe('Agent Settings read/write', () => {
    it('should return null if agent settings do not exist', async () => {
      const agent = await getAgent('non-existent', testDir);
      expect(agent).toBeNull();
    });

    it('should throw an error if agent settings JSON is invalid', async () => {
      const p = getAgentSettingsPath('agent-invalid-json', testDir);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, '{ invalid json', 'utf-8');

      await expect(getAgent('agent-invalid-json', testDir)).rejects.toThrow(/Invalid JSON/);
    });

    it('should throw an error if agent settings schema is invalid', async () => {
      const p = getAgentSettingsPath('agent-invalid-schema', testDir);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, JSON.stringify({ directory: 123 }), 'utf-8'); // directory should be string

      await expect(getAgent('agent-invalid-schema', testDir)).rejects.toThrow(/Invalid schema/);
    });

    it('should write and read agent settings', async () => {
      const agentData: Agent = {
        env: { FOO: 'bar' },
        directory: './test-dir',
        commands: { new: 'test-new' },
      };
      await writeAgentSettings('agent-1', agentData, testDir);

      const p = getAgentSettingsPath('agent-1', testDir);
      expect(fs.existsSync(p)).toBe(true);

      const agent = await getAgent('agent-1', testDir);
      expect(agent).toEqual({ ...agentData, files: './attachments' });
    });

    it('should return list of agents', async () => {
      const agentData: Agent = { env: { FOO: 'bar' } };
      await writeAgentSettings('agent-a', agentData, testDir);
      await writeAgentSettings('agent-b', agentData, testDir);

      const agentsDir = path.join(clawminiDir, 'agents');
      // Create a dummy dir without settings.json
      await fsPromises.mkdir(path.join(agentsDir, 'agent-c'), { recursive: true });

      const list = await listAgents(testDir);
      expect(list.sort()).toEqual(['agent-a', 'agent-b']);
    });

    it('should delete agent', async () => {
      const agentData: Agent = { env: { FOO: 'bar' } };
      await writeAgentSettings('agent-to-delete', agentData, testDir);

      let list = await listAgents(testDir);
      expect(list).toContain('agent-to-delete');

      await deleteAgent('agent-to-delete', testDir);

      list = await listAgents(testDir);
      expect(list).not.toContain('agent-to-delete');
    });
  });

  describe('resolveTargetAgentSkillsDir', () => {
    it('should throw if agent directory does not exist', async () => {
      await expect(resolveTargetAgentSkillsDir('non-existent', testDir)).rejects.toThrow(
        'Agent not found: non-existent'
      );
    });

    it('should resolve custom skillsDir if settings.json is valid', async () => {
      const agentData: Agent = { skillsDir: 'custom-skills-dir' };
      await writeAgentSettings('agent-custom-skills', agentData, testDir);

      const resolved = await resolveTargetAgentSkillsDir('agent-custom-skills', testDir);
      expect(resolved).toBe(path.join(testDir, 'agent-custom-skills', 'custom-skills-dir'));
    });

    it('should fall back to .agents/skills if skillsDir is missing from settings', async () => {
      const agentData: Agent = { env: {} };
      await writeAgentSettings('agent-no-skillsdir', agentData, testDir);

      const resolved = await resolveTargetAgentSkillsDir('agent-no-skillsdir', testDir);
      expect(resolved).toBe(path.join(testDir, 'agent-no-skillsdir', '.agents', 'skills'));
    });

    it('should fall back to .agents/skills if settings.json is missing or malformed', async () => {
      const agentDir = path.join(clawminiDir, 'agents', 'agent-malformed');
      await fsPromises.mkdir(agentDir, { recursive: true });
      await fsPromises.writeFile(path.join(agentDir, 'settings.json'), '{ malformed json', 'utf-8');

      const resolved = await resolveTargetAgentSkillsDir('agent-malformed', testDir);
      expect(resolved).toBe(path.join(testDir, 'agent-malformed', '.agents', 'skills'));
    });
  });

  describe('Agent Session Settings read/write', () => {
    it('should return null if agent session settings do not exist', async () => {
      const settings = await readAgentSessionSettings('agent-1', 'session-1', testDir);
      expect(settings).toBeNull();
    });

    it('should write and read agent session settings', async () => {
      const data = { context: 'some context', step: 5 };
      await writeAgentSessionSettings('agent-1', 'session-1', data, testDir);

      const p = getAgentSessionSettingsPath('agent-1', 'session-1', testDir);
      expect(fs.existsSync(p)).toBe(true);

      const settings = await readAgentSessionSettings('agent-1', 'session-1', testDir);
      expect(settings).toEqual(data);
    });

    it('should return null if JSON is invalid', async () => {
      const p = getAgentSessionSettingsPath('agent-invalid', 'session-invalid', testDir);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, 'invalid json }', 'utf-8');

      const settings = await readAgentSessionSettings('agent-invalid', 'session-invalid', testDir);
      expect(settings).toBeNull();
    });
  });

  describe('Template resolution and copying', () => {
    it('should resolve local template first', async () => {
      const templateName = 'test-template';
      const localTemplateDir = path.join(clawminiDir, 'templates', templateName);
      await fsPromises.mkdir(localTemplateDir, { recursive: true });

      const resolved = await resolveTemplatePath(templateName, testDir);
      expect(resolved).toBe(localTemplateDir);
    });

    it('should fall back to built-in template', async () => {
      const templateName = 'test-builtin';
      // Create a dummy builtin template in the project root's templates dir
      const workspaceRoot = getWorkspaceRoot(process.cwd());
      const builtinTemplateDir = path.join(workspaceRoot, 'templates', templateName);
      await fsPromises.mkdir(builtinTemplateDir, { recursive: true });

      try {
        const resolved = await resolveTemplatePath(templateName, testDir);
        expect(resolved).toBe(builtinTemplateDir);
      } finally {
        await fsPromises.rm(builtinTemplateDir, { recursive: true, force: true });
      }
    });

    it('should throw if template not found', async () => {
      await expect(resolveTemplatePath('non-existent-template', testDir)).rejects.toThrow(
        'Template not found: non-existent-template'
      );
    });

    it('should copy template to empty directory', async () => {
      const templateName = 'copy-template';
      const localTemplateDir = path.join(clawminiDir, 'templates', templateName);
      await fsPromises.mkdir(localTemplateDir, { recursive: true });
      await fsPromises.writeFile(path.join(localTemplateDir, 'file.txt'), 'hello', 'utf-8');

      const targetDir = path.join(testDir, 'target-dir');
      await fsPromises.mkdir(targetDir, { recursive: true });

      await copyTemplate(templateName, targetDir, testDir);

      const content = await fsPromises.readFile(path.join(targetDir, 'file.txt'), 'utf-8');
      expect(content).toBe('hello');
    });

    it('should fail if target directory is not empty', async () => {
      const templateName = 'copy-template-fail';
      const localTemplateDir = path.join(clawminiDir, 'templates', templateName);
      await fsPromises.mkdir(localTemplateDir, { recursive: true });

      const targetDir = path.join(testDir, 'target-dir-fail');
      await fsPromises.mkdir(targetDir, { recursive: true });
      await fsPromises.writeFile(path.join(targetDir, 'existing.txt'), 'existing', 'utf-8');

      await expect(copyTemplate(templateName, targetDir, testDir)).rejects.toThrow(
        `Target directory is not empty: ${targetDir}`
      );
    });

    it('should fail if target directory does not exist', async () => {
      const templateName = 'copy-template-create';
      const localTemplateDir = path.join(clawminiDir, 'templates', templateName);
      await fsPromises.mkdir(localTemplateDir, { recursive: true });
      await fsPromises.writeFile(path.join(localTemplateDir, 'file.txt'), 'hello', 'utf-8');

      const targetDir = path.join(testDir, 'target-dir-create');
      // Intentionally not creating the target directory

      await expect(copyTemplate(templateName, targetDir, testDir)).rejects.toThrow(
        `Target directory does not exist: ${targetDir}`
      );
    });
  });

  describe('Settings and Environments', () => {
    it('should read and write settings', async () => {
      const data: Settings = { environments: { './': 'default-env' }, files: './files' };
      await writeSettings(data, testDir);
      const read = await readSettings(testDir);
      expect(read).toEqual(data);
    });

    it('should return null if reading non-existent settings', async () => {
      const read = await readSettings(testDir);
      expect(read).toBeNull();
    });

    it('should return null if reading non-existent environment', async () => {
      const read = await readEnvironment('non-existent', testDir);
      expect(read).toBeNull();
    });

    it('should read environment env.json', async () => {
      const envDir = path.join(clawminiDir, 'environments', 'test-env');
      await fsPromises.mkdir(envDir, { recursive: true });
      const envData: Environment = { prefix: 'test run {ENV_ARGS}' };
      await fsPromises.writeFile(path.join(envDir, 'env.json'), JSON.stringify(envData));

      const read = await readEnvironment('test-env', testDir);
      expect(read).toEqual(envData);
    });

    it('should get active environment name based on specificity', async () => {
      const data: Settings = {
        environments: {
          './': 'root-env',
          './agents': 'agents-env',
          './agents/specific-agent': 'specific-env',
        },
      };
      await writeSettings(data, testDir);

      expect(await getActiveEnvironmentName('./', testDir)).toBe('root-env');
      expect(await getActiveEnvironmentName('./other', testDir)).toBe('root-env');
      expect(await getActiveEnvironmentName('./agents/some-agent', testDir)).toBe('agents-env');
      expect(await getActiveEnvironmentName('./agents/specific-agent', testDir)).toBe(
        'specific-env'
      );
      expect(await getActiveEnvironmentName('./agents/specific-agent/sub', testDir)).toBe(
        'specific-env'
      );
    });

    it('should return null if no environment matches', async () => {
      const data: Settings = {
        environments: {
          './agents': 'agents-env',
        },
      };
      await writeSettings(data, testDir);
      // './' is not inside './agents'
      expect(await getActiveEnvironmentName('./', testDir)).toBeNull();
    });
  });

  describe('resolvePolicies', () => {
    const scriptsDir = path.join(clawminiDir, 'policy-scripts');
    const proposeScript = path.join(scriptsDir, 'propose-policy.js');

    function installProposePolicyScript() {
      fs.mkdirSync(scriptsDir, { recursive: true });
      fs.writeFileSync(proposeScript, '#!/usr/bin/env node\n');
    }

    it('returns null when the file is null', () => {
      expect(resolvePolicies(null, clawminiDir)).toBeNull();
    });

    it('injects propose-policy when its script is installed', () => {
      installProposePolicyScript();
      const resolved = resolvePolicies({ policies: {} }, clawminiDir);
      expect(resolved?.policies['propose-policy']).toEqual(BUILTIN_POLICIES['propose-policy']);
    });

    it('omits propose-policy when its script is missing', () => {
      const resolved = resolvePolicies({ policies: {} }, clawminiDir);
      expect(resolved?.policies['propose-policy']).toBeUndefined();
    });

    it('omits propose-policy when explicitly disabled, even if script exists', () => {
      installProposePolicyScript();
      const resolved = resolvePolicies({ policies: { 'propose-policy': false } }, clawminiDir);
      expect(resolved?.policies['propose-policy']).toBeUndefined();
    });

    it('preserves a user-defined propose-policy without overwriting', () => {
      installProposePolicyScript();
      const custom = { command: 'echo', args: ['custom'], description: 'mine' };
      const resolved = resolvePolicies({ policies: { 'propose-policy': custom } }, clawminiDir);
      expect(resolved?.policies['propose-policy']).toEqual(custom);
    });

    it('strips arbitrary entries set to false', () => {
      const resolved = resolvePolicies(
        {
          policies: {
            keep: { command: 'ls' },
            drop: false,
          },
        },
        clawminiDir
      );
      expect(resolved?.policies.keep).toEqual({ command: 'ls' });
      expect(resolved?.policies.drop).toBeUndefined();
    });

    it('does not mutate its input', () => {
      installProposePolicyScript();
      const file = { policies: { drop: false as const, keep: { command: 'ls' } } };
      const before = JSON.parse(JSON.stringify(file));
      resolvePolicies(file, clawminiDir);
      expect(file).toEqual(before);
    });
  });
});
