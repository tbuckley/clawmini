import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleRoutingCommand, type RoutingTrpcClient } from './routing.js';

describe('handleRoutingCommand', () => {
  let mockTrpcClient: RoutingTrpcClient;

  beforeEach(() => {
    mockTrpcClient = {
      getChats: { query: vi.fn().mockResolvedValue(['chat-1', 'chat-2']) },
      getAgents: { query: vi.fn().mockResolvedValue(['agent-1', 'agent-2']) },
      createChat: { mutation: vi.fn().mockResolvedValue({ success: true, chatId: 'new-chat' }) },
      sendMessage: { mutate: vi.fn().mockResolvedValue({ success: true }) },
    };
  });

  describe('/chat', () => {
    it('should list available chats if no id provided', async () => {
      const result = await handleRoutingCommand('/chat', 'ext-1', {}, 'discord', mockTrpcClient);
      expect(result).toEqual({
        type: 'reply',
        text: 'Available chats:\n- chat-1\n- chat-2\n\nPlease specify a valid chat ID: `/chat [chat-id]`',
      });
    });

    it('should list available chats if invalid id provided', async () => {
      const result = await handleRoutingCommand(
        '/chat chat-3',
        'ext-1',
        {},
        'discord',
        mockTrpcClient
      );
      expect(result).toEqual({
        type: 'reply',
        text: 'Available chats:\n- chat-1\n- chat-2\n\nPlease specify a valid chat ID: `/chat [chat-id]`',
      });
    });

    it('should return error if chat is already mapped to another channel', async () => {
      const result = await handleRoutingCommand(
        '/chat chat-1',
        'ext-1',
        { 'ext-2': 'chat-1' },
        'discord',
        mockTrpcClient
      );
      expect(result).toEqual({
        type: 'reply',
        text: 'Error: Chat `chat-1` is already mapped to another channel/space. Strict 1:1 mapping is required.',
      });
    });

    it('should map successfully if chat is valid and unmapped', async () => {
      const result = await handleRoutingCommand(
        '/chat chat-1',
        'ext-1',
        {},
        'discord',
        mockTrpcClient
      );
      expect(result).toEqual({
        type: 'mapped',
        text: 'Successfully mapped this channel/space to chat `chat-1`.',
        newChatId: 'chat-1',
      });
    });

    it('should map successfully if chat is already mapped to the same channel', async () => {
      const result = await handleRoutingCommand(
        '/chat chat-1',
        'ext-1',
        { 'ext-1': 'chat-1' },
        'discord',
        mockTrpcClient
      );
      expect(result).toEqual({
        type: 'mapped',
        text: 'Successfully mapped this channel/space to chat `chat-1`.',
        newChatId: 'chat-1',
      });
    });
  });

  describe('/agent', () => {
    it('should list available agents if no id provided', async () => {
      const result = await handleRoutingCommand('/agent', 'ext-1', {}, 'discord', mockTrpcClient);
      expect(result).toEqual({
        type: 'reply',
        text: 'Available agents:\n- agent-1\n- agent-2\n\nPlease specify a valid agent ID: `/agent [agent-id]`',
      });
    });

    it('should create new chat and map it if agent is valid', async () => {
      const result = await handleRoutingCommand(
        '/agent agent-1',
        'ext-1',
        {},
        'discord',
        mockTrpcClient
      );

      expect(mockTrpcClient.createChat.mutation).toHaveBeenCalledWith({
        chatId: 'agent-1-discord',
        agent: 'agent-1',
      });

      expect(result).toEqual({
        type: 'mapped',
        text: 'Successfully created new chat `agent-1-discord` with agent `agent-1` and mapped it to this channel/space.',
        newChatId: 'agent-1-discord',
      });
    });

    it('should append counter if base chat id exists', async () => {
      mockTrpcClient.getChats.query = vi
        .fn()
        .mockResolvedValue(['agent-1-discord', 'agent-1-discord-1']);

      const result = await handleRoutingCommand(
        '/agent agent-1',
        'ext-1',
        {},
        'discord',
        mockTrpcClient
      );

      expect(mockTrpcClient.createChat.mutation).toHaveBeenCalledWith({
        chatId: 'agent-1-discord-2',
        agent: 'agent-1',
      });

      expect(result).toEqual({
        type: 'mapped',
        text: 'Successfully created new chat `agent-1-discord-2` with agent `agent-1` and mapped it to this channel/space.',
        newChatId: 'agent-1-discord-2',
      });
    });
  });

  it('should return null for non-routing commands', async () => {
    const result = await handleRoutingCommand('/filter', 'ext-1', {}, 'discord', mockTrpcClient);
    expect(result).toBeNull();
  });
});
