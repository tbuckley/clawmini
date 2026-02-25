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
} from './workspace.js';

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
      // The startDir is inside testDir, which contains .clawmini
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
      expect(p).toBe(path.join(clawminiDir, 'agents', 'test-agent', 'sessions', 'test-session', 'settings.json'));
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
});
