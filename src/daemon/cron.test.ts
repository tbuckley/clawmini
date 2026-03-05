import { describe, it, expect, vi } from 'vitest';
import { CronManager } from './cron.js';

describe('CronManager', () => {
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
});
