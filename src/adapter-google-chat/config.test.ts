import { describe, it, expect, vi, beforeEach } from 'vitest';
import fsPromises from 'node:fs/promises';
import fs from 'node:fs';
import {
  GoogleChatConfigSchema,
  isAuthorized,
  readGoogleChatConfig,
  getGoogleChatConfigPath,
} from './config.js';

vi.mock('node:fs/promises');
vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn(),
  },
  existsSync: vi.fn(),
}));
vi.mock('../shared/workspace.js', () => ({
  getClawminiDir: () => '/mock/clawmini',
}));

describe('Google Chat Adapter Configuration', () => {
  describe('GoogleChatConfigSchema', () => {
    it('should validate a correct configuration', () => {
      const config = {
        projectId: 'test-project',
        subscriptionName: 'test-sub',
        authorizedUsers: ['test@example.com'],
      };
      const result = GoogleChatConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({
          ...config,
          maxAttachmentSizeMB: 25,
          chatId: 'default',
          driveUploadEnabled: true,
        });
      }
    });

    it('should validate a custom maxAttachmentSizeMB', () => {
      const config = {
        projectId: 'test-project',
        subscriptionName: 'test-sub',
        authorizedUsers: ['test@example.com'],
        maxAttachmentSizeMB: 50,
      };
      const result = GoogleChatConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.maxAttachmentSizeMB).toBe(50);
      }
    });

    it('should validate messages property', () => {
      const config = {
        projectId: 'test-project',
        subscriptionName: 'test-sub',
        authorizedUsers: ['test@example.com'],
        messages: { all: true, test: false },
      };
      const result = GoogleChatConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.messages).toEqual({ all: true, test: false });
      }
    });

    it('should fail validation if fields are missing', () => {
      const result = GoogleChatConfigSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should fail validation if fields are empty', () => {
      const result = GoogleChatConfigSchema.safeParse({
        projectId: '',
        subscriptionName: '',
        authorizedUsers: [],
      });
      expect(result.success).toBe(false);
    });
  });

  describe('isAuthorized', () => {
    it('should return true if user ID or email is in authorized users list', () => {
      expect(isAuthorized('user@example.com', ['user@example.com', 'other@example.com'])).toBe(
        true
      );
    });

    it('should return false if user ID or email is not in authorized users list', () => {
      expect(isAuthorized('unauthorized@example.com', ['user@example.com'])).toBe(false);
    });
  });

  describe('initGoogleChatConfig', () => {
    beforeEach(async () => {
      vi.clearAllMocks();
      vi.mocked(fs.existsSync).mockReturnValue(false);
    });

    it('should create directory and template config file if they do not exist', async () => {
      const { initGoogleChatConfig } = await import('./config.js');
      await initGoogleChatConfig();

      expect(fsPromises.mkdir).toHaveBeenCalledWith('/mock/clawmini/adapters/google-chat', {
        recursive: true,
      });
      expect(fsPromises.writeFile).toHaveBeenCalled();
      const writeCall = vi.mocked(fsPromises.writeFile).mock.calls[0];
      expect(writeCall![0]).toBe(getGoogleChatConfigPath());
      expect(JSON.parse(writeCall![1] as string)).toEqual({
        projectId: 'YOUR_PROJECT_ID',
        subscriptionName: 'YOUR_SUBSCRIPTION_NAME',
        authorizedUsers: ['user@example.com'],
        chatId: 'default',
        driveOauthClientId: 'YOUR_OAUTH_CLIENT_ID',
        driveOauthClientSecret: 'YOUR_OAUTH_CLIENT_SECRET',
      });
    });

    it('should not overwrite existing config file', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      const { initGoogleChatConfig } = await import('./config.js');
      await initGoogleChatConfig();

      expect(fsPromises.writeFile).not.toHaveBeenCalled();
    });
  });

  describe('readGoogleChatConfig', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should successfully read and parse a valid config file', async () => {
      const mockConfig = {
        projectId: 'test-project',
        subscriptionName: 'test-sub',
        authorizedUsers: ['user@example.com'],
      };
      vi.mocked(fsPromises.readFile).mockResolvedValue(JSON.stringify(mockConfig));

      const config = await readGoogleChatConfig();
      expect(config).toEqual({
        ...mockConfig,
        maxAttachmentSizeMB: 25,
        chatId: 'default',
        driveUploadEnabled: true,
      });
      expect(fsPromises.readFile).toHaveBeenCalledWith(getGoogleChatConfigPath(), 'utf-8');
    });

    it('should return null if the config file does not exist', async () => {
      vi.mocked(fsPromises.readFile).mockRejectedValue(new Error('File not found'));

      const config = await readGoogleChatConfig();
      expect(config).toBeNull();
    });

    it('should return null if the config file contains invalid JSON', async () => {
      vi.mocked(fsPromises.readFile).mockResolvedValue('invalid-json');

      const config = await readGoogleChatConfig();
      expect(config).toBeNull();
    });

    it('should return null if the config fails schema validation', async () => {
      vi.mocked(fsPromises.readFile).mockResolvedValue(
        JSON.stringify({ subscriptionName: 'test' })
      );

      const config = await readGoogleChatConfig();
      expect(config).toBeNull();
    });
  });
});
