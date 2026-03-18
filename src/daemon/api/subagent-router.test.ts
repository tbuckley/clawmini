/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { subagentRouter } from './subagent-router.js';
import * as chats from '../chats.js';
import * as message from '../message.js';
import * as queue from '../queue.js';
import fs from 'node:fs/promises';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    default: {
      ...actual,
      readFile: vi.fn(),
      readdir: vi.fn(),
      stat: vi.fn(),
    },
    readFile: vi.fn(),
    readdir: vi.fn(),
    stat: vi.fn(),
  };
});

vi.mock('../message.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../message.js')>();
  return {
    ...actual,
    handleUserMessage: vi.fn(),
  };
});

vi.mock('../queue.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../queue.js')>();
  return {
    ...actual,
    abortQueuesForDirPrefix: vi.fn(),
  };
});

vi.mock('../chats.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../chats.js')>();
  return {
    ...actual,
    getDefaultChatId: vi.fn(),
    getChatsDir: vi.fn().mockResolvedValue('/mock/chats'),
    getChatRelativePath: vi.fn().mockImplementation((id) => id.replace(/:/g, '/')),
    deleteChat: vi.fn(),
    getMessages: vi.fn(),
    isSubagentChatId: vi.fn().mockImplementation((id) => id.includes(':subagents:')),
  };
});

describe('Subagent Router', () => {
  const mockCtx = {
    tokenPayload: {
      chatId: 'parent-chat',
      agentId: 'my-agent',
      sessionId: 'session-id',
      version: '1',
      iat: 0,
      exp: 0,
    },
    isApiServer: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('subagentAdd', () => {
    it('should create a subagent and trigger execution asynchronously', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('{}');

      const caller = subagentRouter.createCaller(mockCtx as any);
      const result = await caller.add({ message: 'do something' });

      expect(result.subagentId).toMatch(/^[a-f0-9-]+$/);
      expect(message.handleUserMessage).toHaveBeenCalledWith(
        `parent-chat:subagents:${result.subagentId}`,
        'do something',
        expect.any(Object),
        undefined,
        true, // noWait
        expect.any(Function),
        expect.any(String), // sessionId
        'my-agent'
      );
    });

    it('should fail if unauthenticated', async () => {
      const caller = subagentRouter.createCaller({} as any);
      await expect(caller.add({ message: 'do something' })).rejects.toThrow('UNAUTHORIZED');
    });
  });

  describe('subagentList', () => {
    it('should list active subagents for the authenticated parent chat', async () => {
      vi.mocked(fs.readdir).mockResolvedValue([
        { name: 'uuid-1', isDirectory: () => true },
        { name: 'uuid-2', isDirectory: () => true },
        { name: 'file.txt', isDirectory: () => false },
      ] as unknown as Awaited<ReturnType<typeof fs.readdir>>);

      const caller = subagentRouter.createCaller(mockCtx as any);
      const result = await caller.list();

      expect(result).toEqual([
        { id: 'uuid-1', agent: 'default', status: 'unknown', created: 'unknown', snippet: '' },
        { id: 'uuid-2', agent: 'default', status: 'unknown', created: 'unknown', snippet: '' },
      ]);
    });
  });

  describe('subagentTail', () => {
    it('should tail messages from a subagent chat', async () => {
      vi.mocked(fs.stat).mockResolvedValue({} as any);
      vi.mocked(chats.getMessages).mockResolvedValue([
        { id: '1', role: 'user', content: 'hello', timestamp: '1' },
      ]);

      const caller = subagentRouter.createCaller(mockCtx as any);
      const result = await caller.tail({ subagentId: 'uuid1', limit: 5 });

      expect(chats.getMessages).toHaveBeenCalledWith('parent-chat:subagents:uuid1', 5);
      expect(result).toHaveLength(1);
    });

    it('should throw if subagent ID format is invalid after composition', async () => {
      vi.mocked(chats.isSubagentChatId).mockReturnValue(false);
      const caller = subagentRouter.createCaller(mockCtx as any);
      await expect(caller.tail({ subagentId: 'invalid-id' })).rejects.toThrow(
        'Invalid subagent ID'
      );
    });
  });

  describe('subagentSend', () => {
    it('should send a message to a subagent and trigger execution', async () => {
      vi.mocked(chats.isSubagentChatId).mockReturnValue(true);
      vi.mocked(fs.stat).mockResolvedValue({} as any);

      const caller = subagentRouter.createCaller(mockCtx as any);
      await caller.send({ subagentId: 'uuid1', message: 'next step' });

      expect(message.handleUserMessage).toHaveBeenCalledWith(
        'parent-chat:subagents:uuid1',
        'next step',
        expect.any(Object),
        undefined,
        true, // noWait
        expect.any(Function),
        undefined,
        undefined
      );
    });
  });

  describe('subagentStop', () => {
    it('should abort queue for a subagent', async () => {
      vi.mocked(chats.isSubagentChatId).mockReturnValue(true);
      vi.mocked(fs.stat).mockResolvedValue({} as any);
      const caller = subagentRouter.createCaller(mockCtx as any);
      await caller.stop({ subagentId: 'uuid1' });

      expect(queue.abortQueuesForDirPrefix).toHaveBeenCalled();
    });
  });

  describe('subagentDelete', () => {
    it('should abort queue and delete subagent chat', async () => {
      vi.mocked(chats.isSubagentChatId).mockReturnValue(true);
      vi.mocked(fs.stat).mockResolvedValue({} as any);
      const caller = subagentRouter.createCaller(mockCtx as any);
      await caller.delete({ subagentId: 'uuid1' });

      expect(queue.abortQueuesForDirPrefix).toHaveBeenCalled();
      expect(chats.deleteChat).toHaveBeenCalledWith('parent-chat:subagents:uuid1');
    });
  });
});
