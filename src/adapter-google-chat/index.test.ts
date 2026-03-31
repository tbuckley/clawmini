import { describe, it, expect, vi, beforeEach } from 'vitest';
import { main } from './index.js';
import * as config from './config.js';
import * as client from './client.js';
import * as forwarder from './forwarder.js';

vi.mock('./config.js', () => ({
  initGoogleChatConfig: vi.fn(),
  readGoogleChatConfig: vi.fn(),
}));

vi.mock('./client.js', () => ({
  getTRPCClient: vi.fn().mockReturnValue({}),
  startGoogleChatIngestion: vi.fn(),
}));

vi.mock('./forwarder.js', () => ({
  startDaemonToGoogleChatForwarder: vi.fn().mockResolvedValue(undefined),
}));

describe('Google Chat Adapter Entry Point', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize config and exit if init argument is provided', async () => {
    process.argv = ['node', 'index.js', 'init'];
    await main();
    expect(config.initGoogleChatConfig).toHaveBeenCalled();
    expect(config.readGoogleChatConfig).not.toHaveBeenCalled();
    process.argv = []; // reset
  });

  it('should start ingestion and forwarder with valid config', async () => {
    process.argv = ['node', 'index.js'];
    const mockConfig = {
      projectId: 'test-project',
      subscriptionName: 'test-sub',
      topicName: 'test-topic',
      authorizedUsers: ['test@example.com'],
      requireMention: false,
      chatId: 'default',
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(config.readGoogleChatConfig).mockResolvedValue(mockConfig as any);

    await main();

    expect(config.readGoogleChatConfig).toHaveBeenCalled();
    expect(client.getTRPCClient).toHaveBeenCalled();
    expect(client.startGoogleChatIngestion).toHaveBeenCalledWith(
      mockConfig,
      expect.any(Object),
      {}
    );
    expect(forwarder.startDaemonToGoogleChatForwarder).toHaveBeenCalledWith(
      expect.any(Object),
      mockConfig,
      {}
    );
  });
});
