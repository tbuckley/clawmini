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

    it('should inject sessionId into outgoing messages', async () => {
      const logger = createChatLogger('chat-1', undefined, 'session-42');
      await logger.logUserMessage('hello session');
      await logger.logAgentReply({ content: 'reply' });
      await logger.logCommandResult({
        messageId: 'm',
        content: '',
        command: 'echo',
        cwd: '/tmp',
        result: { stdout: '', stderr: '', exitCode: 0 },
      });
      await logger.logToolMessage({
        content: 'c',
        messageId: 'm',
        name: 't',
        payload: {},
      });
      await logger.logSystemMessage({ content: 's', event: 'cron' });

      const calls = vi.mocked(daemonChats.appendMessage).mock.calls;
      expect(calls).toHaveLength(5);
      for (const [, msg] of calls) {
        expect(msg).toEqual(expect.objectContaining({ sessionId: 'session-42' }));
        expect(msg).not.toHaveProperty('subagentId');
      }
    });

    it('should filter incoming logs for the subagent', async () => {
      const mockMessages: ChatMessage[] = [
        { id: '1', role: 'user', content: 'root msg', timestamp: '1', sessionId: undefined },
        {
          id: '2',
          role: 'user',
          content: 'sub msg',
          timestamp: '2',
          subagentId: 'sub-1',
          sessionId: undefined,
        },
        {
          id: '3',
          role: 'user',
          content: 'other sub',
          timestamp: '3',
          subagentId: 'sub-2',
          sessionId: undefined,
        },
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
        { id: '1', role: 'user', content: 'root msg', timestamp: '1', sessionId: undefined },
        {
          id: '2',
          role: 'user',
          content: 'sub msg 1',
          timestamp: '2',
          subagentId: 'sub-1',
          sessionId: undefined,
        },
        {
          id: '3',
          role: 'user',
          content: 'other sub',
          timestamp: '3',
          subagentId: 'sub-2',
          sessionId: undefined,
        },
        {
          id: '4',
          role: 'user',
          content: 'sub msg 2',
          timestamp: '4',
          subagentId: 'sub-1',
          sessionId: undefined,
        },
      ];
      vi.mocked(daemonChats.getMessages).mockResolvedValue(mockMessages);

      const logger = createChatLogger('chat-1', 'sub-1');
      const filtered = await logger.getMessages(1);

      expect(filtered).toHaveLength(1);
      expect(filtered[0]!.id).toBe('4');
    });

    it('should not return subagent messages if no subagentId', async () => {
      const mockMessages: ChatMessage[] = [
        { id: '1', role: 'user', content: 'root msg', timestamp: '1', sessionId: undefined },
        {
          id: '2',
          role: 'user',
          content: 'sub msg 1',
          timestamp: '2',
          subagentId: 'sub-1',
          sessionId: undefined,
        },
      ];
      vi.mocked(daemonChats.getMessages).mockResolvedValue(mockMessages);

      const logger = createChatLogger('chat-1');
      const filtered = await logger.getMessages();

      expect(filtered).toHaveLength(1);
      expect(filtered[0]!.id).toBe('1');
    });

    it('should log system message correctly', async () => {
      const logger = createChatLogger('chat-1');
      await logger.logSystemMessage({ content: 'test', event: 'cron', messageId: 'msg-1' });

      expect(daemonChats.appendMessage).toHaveBeenCalledWith(
        'chat-1',
        expect.objectContaining({
          role: 'system',
          content: 'test',
          event: 'cron',
          messageId: 'msg-1',
        })
      );
    });

    it('should log agent reply correctly', async () => {
      const logger = createChatLogger('chat-1');
      await logger.logAgentReply({ content: 'reply', files: ['test.txt'] });

      expect(daemonChats.appendMessage).toHaveBeenCalledWith(
        'chat-1',
        expect.objectContaining({ role: 'agent', content: 'reply', files: ['test.txt'] })
      );
    });

    it('should log tool message correctly', async () => {
      const logger = createChatLogger('chat-1');
      await logger.logToolMessage({
        content: 'tool content',
        messageId: 'msg-1',
        name: 'myTool',
        payload: { a: 1 },
      });

      expect(daemonChats.appendMessage).toHaveBeenCalledWith(
        'chat-1',
        expect.objectContaining({
          role: 'tool',
          content: 'tool content',
          messageId: 'msg-1',
          name: 'myTool',
          payload: { a: 1 },
        })
      );
    });

    it('should log policy request correctly', async () => {
      const logger = createChatLogger('chat-1');
      await logger.logPolicyRequestMessage({
        content: 'please allow',
        messageId: 'msg-1',
        requestId: 'req-1',
        commandName: 'ls',
        args: ['-la'],
        status: 'pending',
      });

      expect(daemonChats.appendMessage).toHaveBeenCalledWith(
        'chat-1',
        expect.objectContaining({
          role: 'policy',
          content: 'please allow',
          messageId: 'msg-1',
          requestId: 'req-1',
          commandName: 'ls',
          args: ['-la'],
          status: 'pending',
        })
      );
    });
  });
});
