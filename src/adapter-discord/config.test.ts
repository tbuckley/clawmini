import { describe, it, expect, vi, beforeEach } from 'vitest';
import fsPromises from 'node:fs/promises';
import {
  DiscordConfigSchema,
  isAuthorized,
  readDiscordConfig,
  getDiscordConfigPath,
} from './config.js';

vi.mock('node:fs/promises');
vi.mock('../shared/workspace.js', () => ({
  getClawminiDir: () => '/mock/clawmini',
}));

describe('Discord Adapter Configuration', () => {
  describe('DiscordConfigSchema', () => {
    it('should validate a correct configuration', () => {
      const config = {
        botToken: 'my-bot-token',
        authorizedUserId: '1234567890',
      };
      const result = DiscordConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(config);
      }
    });

    it('should fail validation if fields are missing', () => {
      const result = DiscordConfigSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should fail validation if fields are empty', () => {
      const result = DiscordConfigSchema.safeParse({
        botToken: '',
        authorizedUserId: '',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('isAuthorized', () => {
    it('should return true if user ID matches authorized user ID', () => {
      expect(isAuthorized('123', '123')).toBe(true);
    });

    it('should return false if user ID does not match', () => {
      expect(isAuthorized('123', '456')).toBe(false);
    });
  });

  describe('readDiscordConfig', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should successfully read and parse a valid config file', async () => {
      const mockConfig = {
        botToken: 'my-bot-token',
        authorizedUserId: '1234567890',
      };
      vi.mocked(fsPromises.readFile).mockResolvedValue(JSON.stringify(mockConfig));

      const config = await readDiscordConfig();
      expect(config).toEqual(mockConfig);
      expect(fsPromises.readFile).toHaveBeenCalledWith(getDiscordConfigPath(), 'utf-8');
    });

    it('should return null if the config file does not exist', async () => {
      vi.mocked(fsPromises.readFile).mockRejectedValue(new Error('File not found'));

      const config = await readDiscordConfig();
      expect(config).toBeNull();
    });

    it('should return null if the config file contains invalid JSON', async () => {
      vi.mocked(fsPromises.readFile).mockResolvedValue('invalid-json');

      const config = await readDiscordConfig();
      expect(config).toBeNull();
    });

    it('should return null if the config fails schema validation', async () => {
      vi.mocked(fsPromises.readFile).mockResolvedValue(JSON.stringify({ botToken: 'test' }));

      const config = await readDiscordConfig();
      expect(config).toBeNull();
    });
  });
});
