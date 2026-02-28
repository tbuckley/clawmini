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
} from './workspace.js';
import type { Agent } from './config.js';

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
      const data = { theme: 'dark', notifications: true };
      await writeChatSettings('chat-1', data, testDir);

      const p = getChatSettingsPath('chat-1', testDir);
      expect(fs.existsSync(p)).toBe(true);

      const settings = await readChatSettings('chat-1', testDir);
      expect(settings).toEqual(data);
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
      expect(agent).toEqual(agentData);
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

    it('should create target directory if it does not exist', async () => {
      const templateName = 'copy-template-create';
      const localTemplateDir = path.join(clawminiDir, 'templates', templateName);
      await fsPromises.mkdir(localTemplateDir, { recursive: true });
      await fsPromises.writeFile(path.join(localTemplateDir, 'file.txt'), 'hello', 'utf-8');

      const targetDir = path.join(testDir, 'target-dir-create');
      // Intentionally not creating the target directory

      await copyTemplate(templateName, targetDir, testDir);

      const content = await fsPromises.readFile(path.join(targetDir, 'file.txt'), 'utf-8');
      expect(content).toBe('hello');
    });
  });
});
