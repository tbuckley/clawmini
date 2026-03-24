import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createChatLogger } from './chat-logger.js';
import * as daemonChats from '../chats.js';
import { type ChatMessage } from '../chats.js';

vi.mock('../chats.js', async () => {
  const actual = await vi.importActual('../chats.js');
  return {
    ...actual,
    appendMessage: vi.fn(),
    getMessages: vi.fn(),
  };
});

describe('ChatLogger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createChatLogger', () => {
    it('should create a standard logger without subagentId', async () => {
      const logger = createChatLogger('chat-1');
      await logger.logUserMessage('hello');

      expect(daemonChats.appendMessage).toHaveBeenCalledWith(
        'chat-1',
        expect.objectContaining({ role: 'user', content: 'hello' })
      );
    });

    it('should inject subagentId into outgoing messages', async () => {
      const logger = createChatLogger('chat-1', 'sub-1');
      await logger.logUserMessage('hello subagent');

      expect(daemonChats.appendMessage).toHaveBeenCalledWith(
        'chat-1',
        expect.objectContaining({ role: 'user', content: 'hello subagent', subagentId: 'sub-1' })
      );
    });

    it('should filter incoming logs for the subagent', async () => {
      const mockMessages: ChatMessage[] = [
        { id: '1', role: 'user', content: 'root msg', timestamp: '1' },
        { id: '2', role: 'user', content: 'sub msg', timestamp: '2', subagentId: 'sub-1' },
        { id: '3', role: 'user', content: 'other sub', timestamp: '3', subagentId: 'sub-2' },
      ];
      vi.mocked(daemonChats.getMessages).mockResolvedValue(mockMessages);

      const logger = createChatLogger('chat-1', 'sub-1');
      const filtered = await logger.getMessages();

      expect(filtered).toHaveLength(1);
      expect(filtered[0]!.id).toBe('2');
      expect(daemonChats.getMessages).toHaveBeenCalledWith('chat-1');
    });

    it('should limit messages after filtering', async () => {
      const mockMessages: ChatMessage[] = [
        { id: '1', role: 'user', content: 'root msg', timestamp: '1' },
        { id: '2', role: 'user', content: 'sub msg 1', timestamp: '2', subagentId: 'sub-1' },
        { id: '3', role: 'user', content: 'other sub', timestamp: '3', subagentId: 'sub-2' },
        { id: '4', role: 'user', content: 'sub msg 2', timestamp: '4', subagentId: 'sub-1' },
      ];
      vi.mocked(daemonChats.getMessages).mockResolvedValue(mockMessages);

      const logger = createChatLogger('chat-1', 'sub-1');
      const filtered = await logger.getMessages(1);

      expect(filtered).toHaveLength(1);
      expect(filtered[0]!.id).toBe('4');
    });

    it('should return all messages if no subagentId', async () => {
      const mockMessages: ChatMessage[] = [
        { id: '1', role: 'user', content: 'root msg', timestamp: '1' },
        { id: '2', role: 'user', content: 'sub msg 1', timestamp: '2', subagentId: 'sub-1' },
      ];
      vi.mocked(daemonChats.getMessages).mockResolvedValue(mockMessages);

      const logger = createChatLogger('chat-1');
      const filtered = await logger.getMessages();

      expect(filtered).toHaveLength(2);
    });
  });
});
