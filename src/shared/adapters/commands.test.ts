import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleAdapterCommand } from './commands.js';
import fs from 'node:fs/promises';

vi.mock('node:fs/promises', () => ({
  default: {
    writeFile: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('Adapter Commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockTrpcClient = {
    getMessages: {
      query: vi.fn(),
    },
  };

  it('should handle /show all', async () => {
    const config = { messages: {} };
    const result = await handleAdapterCommand(
      '/show all',
      config,
      'config.json',
      mockTrpcClient,
      'chat-1'
    );
    expect(result).toBe('Configuration updated: Showing all messages.');
    expect(config.messages).toEqual({ all: true });
    expect(fs.writeFile).toHaveBeenCalledWith(
      'config.json',
      JSON.stringify(config, null, 2),
      'utf-8'
    );
  });

  it('should handle /hide all', async () => {
    const config = { messages: { agent: true } };
    const result = await handleAdapterCommand(
      '/hide all',
      config,
      'config.json',
      mockTrpcClient,
      'chat-1'
    );
    expect(result).toBe('Configuration updated: Hidden all overrides (using defaults).');
    expect(config.messages).toEqual({});
    expect(fs.writeFile).toHaveBeenCalledWith(
      'config.json',
      JSON.stringify(config, null, 2),
      'utf-8'
    );
  });

  it('should handle /show with no arguments', async () => {
    const config = { messages: {} };
    const result = await handleAdapterCommand(
      '/show',
      config,
      'config.json',
      mockTrpcClient,
      'chat-1'
    );
    expect(result).toContain('Valid options for /show:');
  });

  it('should handle /hide with no arguments', async () => {
    const config = { messages: {} };
    const result = await handleAdapterCommand(
      '/hide',
      config,
      'config.json',
      mockTrpcClient,
      'chat-1'
    );
    expect(result).toContain('Valid options for /hide:');
  });

  it('should handle /show <role>', async () => {
    const config = { messages: {} };
    const result = await handleAdapterCommand(
      '/show agent',
      config,
      'config.json',
      mockTrpcClient,
      'chat-1'
    );
    expect(result).toBe("Configuration updated: Showing messages for 'agent'.");
    expect(config.messages).toEqual({ agent: true });
  });

  it('should handle /hide <role>', async () => {
    const config = { messages: { agent: true } };
    const result = await handleAdapterCommand(
      '/hide subagent',
      config,
      'config.json',
      mockTrpcClient,
      'chat-1'
    );
    expect(result).toBe("Configuration updated: Hiding messages for 'subagent'.");
    expect(config.messages).toEqual({ agent: true, subagent: false });
  });

  it('should handle /debug <N>', async () => {
    const config = { messages: {} }; // defaults
    const mockMessages = [
      { id: '1', role: 'user', content: 'hello' }, // user without subagentId (excluded)
      { id: '2', role: 'agent', content: 'hidden agent', subagentId: 'sub1' }, // agent with subagentId (ignored by default)
      { id: '3', role: 'agent', content: 'visible agent' }, // agent without subagentId (displayed by default)
      { id: '4', role: 'agent', content: 'hidden agent 2', subagentId: 'sub2' }, // agent with subagentId (ignored by default)
    ];

    mockTrpcClient.getMessages.query.mockResolvedValueOnce(mockMessages);

    const result = await handleAdapterCommand(
      '/debug 2',
      config,
      'config.json',
      mockTrpcClient,
      'chat-1'
    );

    expect(mockTrpcClient.getMessages.query).toHaveBeenCalledWith({ chatId: 'chat-1', limit: 20 });

    // Expected to find messages 2 and 4, which are ignored
    expect(result).toContain('Debug Output (2 ignored messages):');
    expect(result).toContain('[From:sub1]\nhidden agent');
    expect(result).toContain('[From:sub2]\nhidden agent 2');
  });

  it('should return null for non-commands', async () => {
    const config = { messages: {} };
    const result = await handleAdapterCommand(
      'hello world',
      config,
      'config.json',
      mockTrpcClient,
      'chat-1'
    );
    expect(result).toBeNull();
  });
});
