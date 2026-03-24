import { describe, it, expect, vi, beforeEach } from 'vitest';
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
    execute,
  });

  it('enforces MAX_CONCURRENT_AGENTS limit', async () => {
    let running = 0;
    const maxRunning = vi.fn();

    const execute = async () => {
      running++;
      maxRunning(running);
      await new Promise((resolve) => setTimeout(resolve, 10));
      running--;
    };

    const tasks = Array.from({ length: 10 }).map((_, i) =>
      createTask(`t${i}`, `root${i}`, `dir${i}`, execute)
    );

    await Promise.all(tasks.map((t) => scheduler.schedule(t)));

    // Ensure it never exceeded 5
    expect(Math.max(...maxRunning.mock.calls.map((c) => c[0]))).toBe(5);
  });

  it('implements resource lock maps (directory and rootChatId)', async () => {
    const executed: string[] = [];
    const execute = (id: string) => async () => {
      executed.push(`${id}-start`);
      await new Promise((resolve) => setTimeout(resolve, 10));
      executed.push(`${id}-end`);
    };

    // t1 and t2 have same dirPath, should run sequentially
    const t1 = createTask('t1', 'root1', 'dirA', execute('t1'));
    const t2 = createTask('t2', 'root2', 'dirA', execute('t2'));

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
    const t1 = createTask('t1', 'root1', 'dirA', execute('t1'));
    // t2 is queued, wants dirA
    const t2 = createTask('t2', 'root2', 'dirA', execute('t2'));
    // t3 is queued later, wants dirB
    const t3 = createTask('t3', 'root3', 'dirB', execute('t3'));

    const p1 = scheduler.schedule(t1);
    const p2 = scheduler.schedule(t2);
    const p3 = scheduler.schedule(t3);

    await Promise.all([p1, p2, p3]);

    // t3 should run concurrently with t1 because it doesn't need dirA
    // t2 should run after t1
    // executed could be t1-start, t3-start, t1-end, t3-end, t2-start, t2-end
    expect(executed.indexOf('t3-start')).toBeLessThan(executed.indexOf('t2-start'));
  });

  it('avoids deadlock with temporary pool expansion', async () => {
    // Fill up to MAX_CONCURRENT_AGENTS
    let blockedCount = 0;

    const executeBlock = (id: string) => async () => {
      // Simulate blocking wait
      scheduler.markBlocked(id);
      blockedCount++;
      await new Promise((resolve) => setTimeout(resolve, 50));
      scheduler.markUnblocked(id);
      blockedCount--;
    };

    // 5 tasks that will block
    const tasks = Array.from({ length: 5 }).map((_, i) =>
      createTask(`t${i}`, `root${i}`, `dir${i}`, executeBlock(`t${i}`))
    );

    const promises = tasks.map((t) => scheduler.schedule(t));

    // Wait for all to be blocked
    await new Promise((resolve) => {
      const check = setInterval(() => {
        if (blockedCount === 5) {
          clearInterval(check);
          resolve(null);
        }
      }, 5);
    });

    // Now schedule a 6th task. It should run immediately because the pool expanded.
    let t6Ran = false;
    const t6 = createTask('t6', 'root6', 'dir6', async () => {
      t6Ran = true;
    });

    await scheduler.schedule(t6);
    expect(t6Ran).toBe(true);

    await Promise.all(promises);
  });

  it('allows subagents to run when parent is blocked', async () => {
    let parentFinished = false;
    let subagentFinished = false;

    const parentTask = createTask('parent', 'root1', 'dir1', async () => {
      scheduler.markBlocked('parent');

      const subTask = createTask('sub', 'root1', 'dir1', async () => {
        subagentFinished = true;
      });

      await scheduler.schedule(subTask);
      scheduler.markUnblocked('parent');
      parentFinished = true;
    });

    await scheduler.schedule(parentTask);

    expect(subagentFinished).toBe(true);
    expect(parentFinished).toBe(true);
  });
});
