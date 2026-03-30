/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CronManager } from './cron.js';
// @ts-expect-error - node-schedule types are missing
import schedule from 'node-schedule';
import { getInitialRouterState } from './message.js';

vi.mock('node-schedule', () => ({
  default: {
    scheduleJob: vi.fn(),
  },
}));

vi.mock('./message.js', () => ({
  getInitialRouterState: vi.fn().mockResolvedValue({}),
  applyRouterStateUpdates: vi.fn(),
  executeDirectMessage: vi.fn(),
}));

vi.mock('../shared/workspace.js', () => ({
  readChatSettings: vi.fn().mockResolvedValue({}),
  getSettingsPath: vi.fn().mockReturnValue('/mock/settings.json'),
}));

vi.mock('../shared/chats.js', () => ({
  listChats: vi.fn().mockResolvedValue([]),
}));

vi.mock('node:fs/promises', () => ({
  default: {
    readFile: vi.fn().mockResolvedValue('{}'),
  },
}));

describe('CronManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws on invalid date in "at" schedule', () => {
    const cronManager = new CronManager();
    expect(() => {
      cronManager.scheduleJob('chat1', {
        id: 'job1',
        createdAt: new Date().toISOString(),
        message: 'hello',
        schedule: { at: 'invalid-date' },
      });
    }).toThrow("Invalid date format for 'at' schedule: invalid-date");
  });

  it('correctly schedules an interval "at" schedule', () => {
    const cronManager = new CronManager();
    expect(() => {
      cronManager.scheduleJob('chat2', {
        id: 'job2',
        createdAt: new Date().toISOString(),
        message: 'hello',
        schedule: { at: '2m' },
      });
    }).not.toThrow();
  });

  it('passes job.session.id to getInitialRouterState when session type is existing', async () => {
    const cronManager = new CronManager();
    let scheduledCallback: any = null;
    vi.mocked(schedule.scheduleJob as any).mockImplementation((rule: any, cb: any) => {
      scheduledCallback = cb;
      return { cancel: vi.fn() } as any;
    });

    cronManager.scheduleJob('chat3', {
      id: 'job3',
      createdAt: new Date().toISOString(),
      message: 'test existing session',
      schedule: { at: '1m' },
      session: { type: 'existing', id: 'my-old-session-id' },
    });

    expect(scheduledCallback).toBeTruthy();

    // Execute the cron job callback
    await scheduledCallback();

    expect(getInitialRouterState).toHaveBeenCalledWith(
      'chat3',
      'test existing session',
      expect.any(Object),
      undefined,
      'my-old-session-id'
    );
  });
});
