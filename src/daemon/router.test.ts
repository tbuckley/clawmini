/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { appRouter } from './router.js';
import * as workspace from '../shared/workspace.js';
import * as chats from '../shared/chats.js';
import type { CronJob } from '../shared/config.js';
import * as message from './message.js';
import { getQueue, type Queue } from './queue.js';
import * as fs from 'node:fs/promises';
import path from 'node:path';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    default: {
      ...actual,
      readFile: vi.fn(),
      mkdir: vi.fn(),
      stat: vi.fn(),
      rename: vi.fn(),
      copyFile: vi.fn(),
      unlink: vi.fn(),
      access: vi.fn(),
    },
    readFile: vi.fn(),
    mkdir: vi.fn(),
    stat: vi.fn(),
    rename: vi.fn(),
    copyFile: vi.fn(),
    unlink: vi.fn(),
    access: vi.fn(),
  };
});

vi.mock('./message.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./message.js')>();
  return {
    ...actual,
    handleUserMessage: vi.fn(),
  };
});

vi.mock('../shared/workspace.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../shared/workspace.js')>();
  return {
    ...actual,
    readChatSettings: vi.fn(),
    writeChatSettings: vi.fn(),
    getSettingsPath: vi.fn().mockReturnValue('/mock/settings.json'),
    getAgent: vi.fn(),
    getWorkspaceRoot: vi.fn().mockReturnValue(process.cwd()),
    getActiveEnvironmentName: vi.fn().mockResolvedValue(null),
  getActiveEnvironmentInfo: vi.fn().mockResolvedValue(null),
    getEnvironmentPath: vi.fn().mockReturnValue(''),
    readEnvironment: vi.fn().mockResolvedValue(null),
  };
});

vi.mock('../shared/chats.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../shared/chats.js')>();
  return {
    ...actual,
    getDefaultChatId: vi.fn(),
    appendMessage: vi.fn(),
  };
});

describe('Daemon TRPC Router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Cron Jobs Endpoints', () => {
    const mockJob: CronJob = {
      id: 'job-1',
      message: 'test message',
      schedule: { cron: '* * * * *' },
    };

    it('listCronJobs should return empty array if no jobs exist', async () => {
      vi.mocked(chats.getDefaultChatId).mockResolvedValue('default-chat');
      vi.mocked(workspace.readChatSettings).mockResolvedValue({});

      const caller = appRouter.createCaller({});
      const jobs = await caller.listCronJobs({});
      expect(jobs).toEqual([]);
      expect(workspace.readChatSettings).toHaveBeenCalledWith('default-chat');
    });

    it('listCronJobs should return existing jobs', async () => {
      vi.mocked(chats.getDefaultChatId).mockResolvedValue('default-chat');
      vi.mocked(workspace.readChatSettings).mockResolvedValue({ jobs: [mockJob] });

      const caller = appRouter.createCaller({});
      const jobs = await caller.listCronJobs({ chatId: 'custom-chat' });
      expect(jobs).toEqual([mockJob]);
      expect(workspace.readChatSettings).toHaveBeenCalledWith('custom-chat');
    });

    it('addCronJob should add a new job', async () => {
      vi.mocked(chats.getDefaultChatId).mockResolvedValue('default-chat');
      vi.mocked(workspace.readChatSettings).mockResolvedValue({});

      const caller = appRouter.createCaller({});
      const result = await caller.addCronJob({ job: mockJob });

      expect(result.success).toBe(true);
      expect(workspace.writeChatSettings).toHaveBeenCalledWith('default-chat', {
        jobs: [mockJob],
      });
    });

    it('addCronJob should update an existing job', async () => {
      vi.mocked(chats.getDefaultChatId).mockResolvedValue('default-chat');
      vi.mocked(workspace.readChatSettings).mockResolvedValue({ jobs: [mockJob] });

      const caller = appRouter.createCaller({});
      const updatedJob = { ...mockJob, message: 'updated' };
      const result = await caller.addCronJob({ job: updatedJob });

      expect(result.success).toBe(true);
      expect(workspace.writeChatSettings).toHaveBeenCalledWith('default-chat', {
        jobs: [updatedJob],
      });
    });

    it('deleteCronJob should delete an existing job', async () => {
      vi.mocked(chats.getDefaultChatId).mockResolvedValue('default-chat');
      vi.mocked(workspace.readChatSettings).mockResolvedValue({ jobs: [mockJob] });

      const caller = appRouter.createCaller({});
      const result = await caller.deleteCronJob({ id: 'job-1' });

      expect(result.success).toBe(true);
      expect(result.deleted).toBe(true);
      expect(workspace.writeChatSettings).toHaveBeenCalledWith('default-chat', { jobs: [] });
    });

    it('deleteCronJob should return deleted: false if job not found', async () => {
      vi.mocked(chats.getDefaultChatId).mockResolvedValue('default-chat');
      vi.mocked(workspace.readChatSettings).mockResolvedValue({ jobs: [mockJob] });

      const caller = appRouter.createCaller({});
      const result = await caller.deleteCronJob({ id: 'non-existent' });

      expect(result.success).toBe(true);
      expect(result.deleted).toBe(false);
      expect(workspace.writeChatSettings).not.toHaveBeenCalled();
    });
  });

  describe('sendMessage with files processing', () => {
    it('should pass message through when no files are provided', async () => {
      vi.mocked(chats.getDefaultChatId).mockResolvedValue('default-chat');
      vi.mocked((fs as any).default.readFile).mockResolvedValue('{}');

      const caller = appRouter.createCaller({});
      await caller.sendMessage({
        type: 'send-message',
        client: 'cli',
        data: { message: 'hello', chatId: 'default-chat' },
      });

      expect(message.handleUserMessage).toHaveBeenCalledWith(
        'default-chat',
        'hello',
        {},
        undefined,
        false,
        expect.any(Function),
        undefined,
        undefined
      );
      expect((fs as any).default.mkdir).not.toHaveBeenCalled();
    });

    it('should process files and format message correctly', async () => {
      vi.mocked(chats.getDefaultChatId).mockResolvedValue('default-chat');
      vi.mocked((fs as any).default.readFile).mockResolvedValue('{}');
      vi.mocked(workspace.readChatSettings).mockResolvedValue({ defaultAgent: 'default' });
      vi.mocked((fs as any).default.stat).mockRejectedValue(new Error('not found')); // Files do not exist (no collision)
      vi.mocked((fs as any).default.rename).mockResolvedValue(undefined);
      vi.mocked((fs as any).default.access).mockResolvedValue(undefined);

      const caller = appRouter.createCaller({});
      await caller.sendMessage({
        type: 'send-message',
        client: 'cli',
        data: {
          message: 'hello',
          chatId: 'default-chat',
          files: ['.clawmini/tmp/file1.txt', '.clawmini/tmp/file2.png'],
          adapter: 'discord',
        },
      });

      expect((fs as any).default.mkdir).toHaveBeenCalledWith(
        expect.stringContaining(path.join('attachments', 'discord')),
        { recursive: true }
      );
      expect((fs as any).default.rename).toHaveBeenCalledTimes(2);

      const handleUserMessageCall = vi.mocked(message.handleUserMessage).mock.calls[0];
      expect(handleUserMessageCall).toBeDefined();
      const formattedMessage = handleUserMessageCall![1];
      expect(formattedMessage).toContain('Attached files:');
      expect(formattedMessage).toContain('- ' + path.normalize('attachments/discord/file1.txt'));
      expect(formattedMessage).toContain('- ' + path.normalize('attachments/discord/file2.png'));
    });

    it('should handle file collision by appending timestamp', async () => {
      vi.mocked(chats.getDefaultChatId).mockResolvedValue('default-chat');
      vi.mocked((fs as any).default.readFile).mockResolvedValue('{}');
      vi.mocked(workspace.readChatSettings).mockResolvedValue({ defaultAgent: 'default' });
      vi.mocked((fs as any).default.access).mockResolvedValue(undefined);

      // Simulate file already exists for collision
      vi.mocked((fs as any).default.stat)
        .mockResolvedValueOnce({} as import('node:fs').Stats)
        .mockRejectedValue(new Error('not found'));
      vi.mocked((fs as any).default.rename).mockResolvedValue(undefined);

      const caller = appRouter.createCaller({});
      await caller.sendMessage({
        type: 'send-message',
        client: 'cli',
        data: {
          message: 'hello',
          chatId: 'default-chat',
          files: ['.clawmini/tmp/file1.txt'],
          adapter: 'discord',
        },
      });

      expect((fs as any).default.rename).toHaveBeenCalledWith(
        '.clawmini/tmp/file1.txt',
        expect.stringMatching(/file1-\d+\.txt$/)
      );

      const handleUserMessageCall = vi.mocked(message.handleUserMessage).mock.calls[0];
      expect(handleUserMessageCall).toBeDefined();
      const formattedMessage = handleUserMessageCall![1];
      expect(formattedMessage).toMatch(/- .*file1-\d+\.txt/);
    });

    it('should reject file path outside .clawmini/tmp for sendMessage', async () => {
      vi.mocked(chats.getDefaultChatId).mockResolvedValue('default-chat');
      vi.mocked((fs as any).default.readFile).mockResolvedValue('{}');

      const caller = appRouter.createCaller({});
      await expect(
        caller.sendMessage({
          type: 'send-message',
          client: 'cli',
          data: {
            message: 'hello',
            chatId: 'default-chat',
            files: ['/etc/passwd'],
          },
        })
      ).rejects.toThrow('File must be inside the temporary directory.');
    });

    it('should reject non-existent file for sendMessage', async () => {
      vi.mocked(chats.getDefaultChatId).mockResolvedValue('default-chat');
      vi.mocked((fs as any).default.readFile).mockResolvedValue('{}');
      vi.mocked((fs as any).default.access).mockRejectedValue(new Error('ENOENT'));

      const caller = appRouter.createCaller({});
      await expect(
        caller.sendMessage({
          type: 'send-message',
          client: 'cli',
          data: {
            message: 'hello',
            chatId: 'default-chat',
            files: ['.clawmini/tmp/missing.txt'],
          },
        })
      ).rejects.toThrow('File does not exist: .clawmini/tmp/missing.txt');
    });
  });

  describe('logMessage', () => {
    it('should save a log message without a file', async () => {
      vi.mocked(chats.getDefaultChatId).mockResolvedValue('default-chat');
      vi.mocked(chats.appendMessage).mockResolvedValue(undefined);

      const caller = appRouter.createCaller({});
      const result = await caller.logMessage({
        chatId: 'default-chat',
        message: 'Test log',
      });

      expect(result.success).toBe(true);
      expect(chats.appendMessage).toHaveBeenCalledWith(
        'default-chat',
        expect.objectContaining({
          role: 'log',
          content: 'Test log',
        }),
        expect.any(String)
      );
    });

    it('should validate and save a log message with a valid file path', async () => {
      vi.mocked(chats.getDefaultChatId).mockResolvedValue('default-chat');
      vi.mocked(chats.appendMessage).mockResolvedValue(undefined);
      vi.mocked((fs as any).default.access).mockResolvedValue(undefined);

      const caller = appRouter.createCaller({});
      const result = await caller.logMessage({
        chatId: 'default-chat',
        message: 'Test log with file',
        files: ['attachments/discord/image.png'],
      });

      expect(result.success).toBe(true);
      expect(chats.appendMessage).toHaveBeenCalledWith(
        'default-chat',
        expect.objectContaining({
          role: 'log',
          content: 'Test log with file',
          files: [path.normalize('attachments/discord/image.png')],
        }),
        expect.any(String)
      );
    });
    it('should reject file path with directory traversal (..)', async () => {
      vi.mocked(chats.getDefaultChatId).mockResolvedValue('default-chat');

      const caller = appRouter.createCaller({});
      await expect(
        caller.logMessage({
          chatId: 'default-chat',
          message: 'Malicious log',
          files: ['../secret.txt'],
        })
      ).rejects.toThrow('File must be within the agent workspace.');
    });

    it('should reject file path with absolute path', async () => {
      vi.mocked(chats.getDefaultChatId).mockResolvedValue('default-chat');

      const caller = appRouter.createCaller({});
      await expect(
        caller.logMessage({
          chatId: 'default-chat',
          message: 'Malicious log',
          files: ['/etc/passwd'],
        })
      ).rejects.toThrow('File must be within the agent workspace.');
    });
  });

  describe('Subscriptions', () => {
    it('waitForTyping should yield typing events for the correct chatId', async () => {
      vi.mocked(chats.getDefaultChatId).mockResolvedValue('default-chat');

      const caller = appRouter.createCaller({});
      const iterable = await caller.waitForTyping({ chatId: 'default-chat' });
      const iterator = iterable[Symbol.asyncIterator]();

      const events: any[] = [];
      const iteratePromise = (async () => {
        const e1 = await iterator.next();
        if (e1.value) events.push(e1.value);
        const e2 = await iterator.next();
        if (e2.value) events.push(e2.value);
      })();

      const { daemonEvents, DAEMON_EVENT_TYPING } = await import('./events.js');
      await new Promise((resolve) => setTimeout(resolve, 10));

      daemonEvents.emit(DAEMON_EVENT_TYPING, { chatId: 'default-chat' });
      daemonEvents.emit(DAEMON_EVENT_TYPING, { chatId: 'other-chat' });
      daemonEvents.emit(DAEMON_EVENT_TYPING, { chatId: 'default-chat' });

      await iteratePromise;

      expect(events).toEqual([{ chatId: 'default-chat' }, { chatId: 'default-chat' }]);
    });
  });

  describe('fetchPendingMessages', () => {
    let queue: Queue;
    beforeEach(() => {
      queue = getQueue(process.cwd());
      queue.clear();
    });

    it('should extract pending messages from queue and format them', async () => {
      let resolveFirstTask: () => void;
      const firstTaskPromise = new Promise<void>((r) => {
        resolveFirstTask = r;
      });

      // The first task will start and block, leaving the others in pending
      queue.enqueue(async () => {
        await firstTaskPromise;
      }, 'Task 1');

      // These will stay in pending
      const p2 = queue.enqueue(async () => {}, 'Task 2');
      const p3 = queue.enqueue(async () => {}, 'Task 3');

      // We expect them to throw AbortError when extracted
      p2.catch(() => {});
      p3.catch(() => {});

      const caller = appRouter.createCaller({});
      const result = await caller.fetchPendingMessages();

      expect(result.messages).toBe(
        '<message>\nTask 2\n</message>\n\n<message>\nTask 3\n</message>'
      );
      expect(queue.extractPending()).toEqual([]);

      resolveFirstTask!(); // cleanup
    });

    it('should return empty string if no pending messages', async () => {
      const caller = appRouter.createCaller({});
      const result = await caller.fetchPendingMessages();
      expect(result.messages).toBe('');
    });
  });
});
