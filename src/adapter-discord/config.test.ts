import { describe, it, expect, vi, beforeEach } from 'vitest';
import fsPromises from 'node:fs/promises';
import {
  DiscordConfigSchema,
  isAuthorized,
  readDiscordConfig,
  getDiscordConfigPath,
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
        expect(result.data).toEqual({
          ...config,
          chatId: 'default',
          maxAttachmentSizeMB: 25,
        });
      }
    });

    it('should validate a custom maxAttachmentSizeMB', () => {
      const config = {
        botToken: 'my-bot-token',
        authorizedUserId: '1234567890',
        maxAttachmentSizeMB: 50,
      };
      const result = DiscordConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.maxAttachmentSizeMB).toBe(50);
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

  describe('initDiscordConfig', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let fsMock: any;

    beforeEach(async () => {
      vi.clearAllMocks();
      fsMock = await import('node:fs');
      vi.mocked(fsMock.existsSync).mockReturnValue(false);
      if (fsMock.default) {
        vi.mocked(fsMock.default.existsSync).mockReturnValue(false);
      }
    });

    it('should create directory and template config file if they do not exist', async () => {
      const { initDiscordConfig } = await import('./config.js');
      await initDiscordConfig();

      expect(fsPromises.mkdir).toHaveBeenCalledWith('/mock/clawmini/adapters/discord', {
        recursive: true,
      });
      expect(fsPromises.writeFile).toHaveBeenCalled();
      const writeCall = vi.mocked(fsPromises.writeFile).mock.calls[0];
      expect(writeCall![0]).toBe(getDiscordConfigPath());
      expect(JSON.parse(writeCall![1] as string)).toEqual({
        botToken: 'YOUR_DISCORD_BOT_TOKEN',
        authorizedUserId: 'YOUR_DISCORD_USER_ID',
        chatId: 'default',
      });
    });

    it('should not overwrite existing config file', async () => {
      vi.mocked(fsMock.existsSync).mockReturnValue(true);
      if (fsMock.default) {
        vi.mocked(fsMock.default.existsSync).mockReturnValue(true);
      }
      const { initDiscordConfig } = await import('./config.js');
      await initDiscordConfig();

      expect(fsPromises.writeFile).not.toHaveBeenCalled();
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
      expect(config).toEqual({ ...mockConfig, chatId: 'default', maxAttachmentSizeMB: 25 });
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
