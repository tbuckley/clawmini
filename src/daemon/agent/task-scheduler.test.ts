import { describe, it, expect, beforeEach } from 'vitest';
import { TaskScheduler } from './task-scheduler.js';

describe('TaskScheduler', () => {
  let scheduler: TaskScheduler;

  beforeEach(() => {
    scheduler = new TaskScheduler();
  });

  const createTask = (
    id: string,
    rootChatId: string,
    dirPath: string,
    execute: (signal: AbortSignal) => Promise<void>,
    sessionId: string = 'test-session'
  ) => ({
    id,
    rootChatId,
    dirPath,
    sessionId,
    text: `task-${id}`,
    execute,
  });

  it('implements resource lock maps (directory and rootChatId)', async () => {
    const executed: string[] = [];
    const execute = (id: string) => async () => {
      executed.push(`${id}-start`);
      await new Promise((resolve) => setTimeout(resolve, 10));
      executed.push(`${id}-end`);
    };

    // t1 and t2 have same dirPath but different rootChatIds, should run sequentially
    const t1 = createTask('t1', 'root1', 'dirA', execute('t1'), 'session1');
    const t2 = createTask('t2', 'root2', 'dirA', execute('t2'), 'session2');

    const p1 = scheduler.schedule(t1);
    const p2 = scheduler.schedule(t2);

    await Promise.all([p1, p2]);

    expect(executed).toEqual(['t1-start', 't1-end', 't2-start', 't2-end']);
  });

  it('processes tasks sequentially for the same session', async () => {
    const executed: string[] = [];
    const execute = (id: string) => async () => {
      executed.push(`${id}-start`);
      await new Promise((resolve) => setTimeout(resolve, 10));
      executed.push(`${id}-end`);
    };

    const t1 = createTask('t1', 'root1', 'dirA', execute('t1'), 'session1');
    const t2 = createTask('t2', 'root1', 'dirA', execute('t2'), 'session1');

    const p1 = scheduler.schedule(t1);
    const p2 = scheduler.schedule(t2);

    await Promise.all([p1, p2]);

    expect(executed).toEqual(['t1-start', 't1-end', 't2-start', 't2-end']);
  });

  it('processes oldest tasks first (starvation avoidance)', async () => {
    const executed: string[] = [];
    const execute = (id: string) => async () => {
      executed.push(`${id}-start`);
      await new Promise((resolve) => setTimeout(resolve, 10));
      executed.push(`${id}-end`);
    };

    // t1 blocks dirA
    const t1 = createTask('t1', 'root1', 'dirA', execute('t1'), 'session1');
    // t2 is queued, wants dirA
    const t2 = createTask('t2', 'root2', 'dirA', execute('t2'), 'session2');
    // t3 is queued later, wants dirB
    const t3 = createTask('t3', 'root3', 'dirB', execute('t3'), 'session3');

    const p1 = scheduler.schedule(t1);
    const p2 = scheduler.schedule(t2);
    const p3 = scheduler.schedule(t3);

    await Promise.all([p1, p2, p3]);

    // t3 should run concurrently with t1 because it doesn't need dirA
    // t2 should run after t1
    // executed could be t1-start, t3-start, t1-end, t3-end, t2-start, t2-end
    expect(executed.indexOf('t3-start')).toBeLessThan(executed.indexOf('t2-start'));
  });

  it('allows subagents to run in parallel when they share a workspace', async () => {
    let parentFinished = false;
    let subagentFinished = false;

    // Parent task in root1, dir1
    const parentTask = createTask(
      'parent',
      'root1',
      'dir1',
      async () => {
        // Schedule subagent task in the same workspace (root1) and same resource (dir1)
        // Since it shares the workspace, it can run in parallel
        const subTask = createTask(
          'sub',
          'root1',
          'dir1',
          async () => {
            subagentFinished = true;
          },
          'sub-session'
        );

        await scheduler.schedule(subTask);
        parentFinished = true;
      },
      'parent-session'
    );

    await scheduler.schedule(parentTask);

    expect(subagentFinished).toBe(true);
    expect(parentFinished).toBe(true);
  });

  it('can extract pending tasks', async () => {
    let parentRunning = false;
    const parentTask = createTask(
      'parent',
      'root1',
      'dir1',
      async () => {
        parentRunning = true;
        await new Promise((resolve) => setTimeout(resolve, 50));
      },
      'session1'
    );

    const pendingTask = createTask('pending', 'root1', 'dir1', async () => {}, 'session1');

    const p1 = scheduler.schedule(parentTask);
    const p2 = scheduler.schedule(pendingTask);

    // Wait for parent to start
    await new Promise((resolve) => {
      const check = setInterval(() => {
        if (parentRunning) {
          clearInterval(check);
          resolve(null);
        }
      }, 5);
    });

    const pending = scheduler.extractPending('session1');
    expect(pending).toEqual(['task-pending']);

    await expect(p2).rejects.toThrow('Task extracted for batching');
    await p1;
  });

  it('can abort all tasks in a session', async () => {
    let parentRunning = false;
    let aborted = false;

    const parentTask = createTask(
      'parent',
      'root1',
      'dir1',
      async (signal) => {
        parentRunning = true;
        return new Promise<void>((_, reject) => {
          signal.addEventListener('abort', () => {
            aborted = true;
            reject(new Error('Aborted'));
          });
        });
      },
      'session1'
    );

    const pendingTask = createTask('pending', 'root1', 'dir1', async () => {}, 'session1');

    const p1 = scheduler.schedule(parentTask);
    const p2 = scheduler.schedule(pendingTask);

    // Wait for parent to start
    await new Promise((resolve) => {
      const check = setInterval(() => {
        if (parentRunning) {
          clearInterval(check);
          resolve(null);
        }
      }, 5);
    });

    scheduler.abortTasks('session1');

    await expect(p1).rejects.toThrow();
    await expect(p2).rejects.toThrow('Task aborted');
    expect(aborted).toBe(true);
  });
});
