import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleAdapterCommand, type CommandTrpcClient } from './commands.js';

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
      mockTrpcClient as unknown as CommandTrpcClient,
      'chat-1'
    );
    expect(result).toEqual({ type: 'text', text: 'Configuration updated: Showing all messages.' });
    expect(config.messages).toEqual({
      subagent: true,
      command: true,
      system: true,
      tool: true,
      policy: true,
      subagent_status: true,
      legacy_log: true,
    });
  });

  it('should handle /hide all', async () => {
    const config = { messages: { tool: true } };
    const result = await handleAdapterCommand(
      '/hide all',
      config,
      mockTrpcClient as unknown as CommandTrpcClient,
      'chat-1'
    );
    expect(result).toEqual({
      type: 'text',
      text: 'Configuration updated: Hidden all overrides (using defaults).',
    });
    expect(config.messages).toEqual({});
  });

  it('should handle /show with no arguments', async () => {
    const config = { messages: {} };
    const result = await handleAdapterCommand(
      '/show',
      config,
      mockTrpcClient as unknown as CommandTrpcClient,
      'chat-1'
    );
    expect(result?.type).toBe('text');
    expect((result as { text: string }).text).toContain('Valid options for /show:');
  });

  it('should handle /hide with no arguments', async () => {
    const config = { messages: {} };
    const result = await handleAdapterCommand(
      '/hide',
      config,
      mockTrpcClient as unknown as CommandTrpcClient,
      'chat-1'
    );
    expect(result?.type).toBe('text');
    expect((result as { text: string }).text).toContain('Valid options for /hide:');
  });

  it('should handle /show <role>', async () => {
    const config = { messages: {} };
    const result = await handleAdapterCommand(
      '/show tool',
      config,
      mockTrpcClient as unknown as CommandTrpcClient,
      'chat-1'
    );
    expect(result).toEqual({
      type: 'text',
      text: "Configuration updated: Showing messages for 'tool'.",
    });
    expect(config.messages).toEqual({ tool: true });
  });

  it('should handle /hide <role>', async () => {
    const config = { messages: { command: true } };
    const result = await handleAdapterCommand(
      '/hide subagent',
      config,
      mockTrpcClient as unknown as CommandTrpcClient,
      'chat-1'
    );
    expect(result).toEqual({
      type: 'text',
      text: "Configuration updated: Hiding messages for 'subagent'.",
    });
    expect(config.messages).toEqual({ command: true, subagent: false });
  });

  it('should handle /debug <N>', async () => {
    const config = { messages: {} }; // defaults
    const mockMessages = [
      { id: '1', role: 'user', content: 'hello' }, // user without subagentId (displayed by default, excluded)
      { id: '2', role: 'agent', content: 'hidden agent', subagentId: 'sub1' }, // agent with subagentId (ignored by default)
      { id: '3', role: 'agent', content: 'visible agent' }, // agent without subagentId (displayed by default)
      { id: '4', role: 'agent', content: 'hidden agent 2', subagentId: 'sub2' }, // agent with subagentId (ignored by default)
    ];

    mockTrpcClient.getMessages.query.mockResolvedValueOnce(mockMessages);

    const result = await handleAdapterCommand(
      '/debug 2',
      config,
      mockTrpcClient as unknown as CommandTrpcClient,
      'chat-1'
    );

    expect(mockTrpcClient.getMessages.query).toHaveBeenCalledWith({ chatId: 'chat-1', limit: 20 });

    expect(result).toEqual({
      type: 'debug',
      messages: [
        { id: '2', role: 'agent', content: 'hidden agent', subagentId: 'sub1' },
        { id: '4', role: 'agent', content: 'hidden agent 2', subagentId: 'sub2' },
      ],
    });
  });

  it('should return null for non-commands', async () => {
    const config = { messages: {} };
    const result = await handleAdapterCommand(
      'hello world',
      config,
      mockTrpcClient as unknown as CommandTrpcClient,
      'chat-1'
    );
    expect(result).toBeNull();
  });
});
