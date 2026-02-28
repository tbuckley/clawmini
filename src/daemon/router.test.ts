import { describe, it, expect, vi, beforeEach } from 'vitest';
import { appRouter } from './router.js';
import * as workspace from '../shared/workspace.js';
import * as chats from '../shared/chats.js';
import type { CronJob } from '../shared/config.js';

vi.mock('../shared/workspace.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../shared/workspace.js')>();
  return {
    ...actual,
    readChatSettings: vi.fn(),
    writeChatSettings: vi.fn(),
  };
});

vi.mock('../shared/chats.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../shared/chats.js')>();
  return {
    ...actual,
    getDefaultChatId: vi.fn(),
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
});
