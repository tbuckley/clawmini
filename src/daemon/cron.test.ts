/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CronManager, normalizeJob } from './cron.js';
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

  it('correctly schedules an absolute "at" schedule', () => {
    const cronManager = new CronManager();
    expect(() => {
      cronManager.scheduleJob('chat2', {
        id: 'job2',
        createdAt: new Date().toISOString(),
        message: 'hello',
        schedule: { at: new Date(Date.now() + 120_000).toISOString() },
      });
    }).not.toThrow();
  });

  it('normalizeJob resolves interval "at" to an absolute ISO timestamp', () => {
    const before = Date.now();
    const normalized = normalizeJob({
      id: 'job-norm',
      createdAt: new Date().toISOString(),
      message: 'hi',
      schedule: { at: '2s' },
    });
    const after = Date.now();
    expect('at' in normalized.schedule).toBe(true);
    const at = (normalized.schedule as { at: string }).at;
    const ms = new Date(at).getTime();
    expect(ms).toBeGreaterThanOrEqual(before + 2000);
    expect(ms).toBeLessThanOrEqual(after + 2000);
  });

  it('normalizeJob preserves an already-absolute "at" value', () => {
    const iso = new Date(Date.now() + 60_000).toISOString();
    const normalized = normalizeJob({
      id: 'job-abs',
      createdAt: new Date().toISOString(),
      message: 'hi',
      schedule: { at: iso },
    });
    expect((normalized.schedule as { at: string }).at).toBe(iso);
  });

  it('normalizeJob throws on unparseable "at" value', () => {
    expect(() =>
      normalizeJob({
        id: 'job-bad',
        createdAt: new Date().toISOString(),
        message: 'hi',
        schedule: { at: 'not-a-date' },
      })
    ).toThrow("Invalid date format for 'at' schedule: not-a-date");
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
      schedule: { at: new Date(Date.now() + 60_000).toISOString() },
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
