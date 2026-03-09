import { describe, it, expect, vi } from 'vitest';
import { Queue } from './queue.js';

describe('Queue', () => {
  it('should process tasks in order', async () => {
    const queue = new Queue();
    const order: number[] = [];

    const task1 = queue.enqueue(async () => {
      await new Promise((r) => setTimeout(r, 10));
      order.push(1);
    });

    const task2 = queue.enqueue(async () => {
      order.push(2);
    });

    await Promise.all([task1, task2]);
    expect(order).toEqual([1, 2]);
  });

  it('should support aborting the current task', async () => {
    const queue = new Queue();
    let aborted = false;

    const task1 = queue.enqueue(async (signal: AbortSignal) => {
      return new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          aborted = true;
          reject(signal.reason);
        };
        signal.addEventListener('abort', onAbort);
      });
    });

    // Let the task start
    await new Promise((r) => setTimeout(r, 0));
    queue.abortCurrent();

    await expect(task1).rejects.toThrow('Task aborted');
    expect(aborted).toBe(true);
  });

  it('should clear pending tasks', async () => {
    const queue = new Queue();
    const mockTask1 = vi.fn().mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    const mockTask2 = vi.fn().mockResolvedValue(undefined);

    const task1 = queue.enqueue(mockTask1);
    const task2 = queue.enqueue(mockTask2);
    task2.catch(() => {});

    queue.clear();

    await task1; // task1 is already running, should complete
    await expect(task2).rejects.toThrow('Task cleared');

    expect(mockTask1).toHaveBeenCalled();
    expect(mockTask2).not.toHaveBeenCalled();
  });

  it('should extract pending tasks', async () => {
    const queue = new Queue();
    const mockTask1 = vi.fn().mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    const mockTask2 = vi.fn().mockResolvedValue(undefined);
    const mockTask3 = vi.fn().mockResolvedValue(undefined);

    const task1 = queue.enqueue(mockTask1, 'payload1');
    const task2 = queue.enqueue(mockTask2, 'payload2');
    const task3 = queue.enqueue(mockTask3); // no payload
    task2.catch(() => {});
    task3.catch(() => {});

    const pendingPayloads = queue.extractPending();

    await task1; // task1 is running
    await expect(task2).rejects.toThrow('Task extracted for batching');
    await expect(task3).rejects.toThrow('Task extracted for batching');

    expect(pendingPayloads).toEqual(['payload2']);
    expect(mockTask1).toHaveBeenCalled();
    expect(mockTask2).not.toHaveBeenCalled();
    expect(mockTask3).not.toHaveBeenCalled();
  });

  it('should extract pending tasks matching predicate', async () => {
    const queue = new Queue<{ sessionId: string; text: string }>();
    const mockTask1 = vi.fn().mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    const mockTask2 = vi.fn().mockResolvedValue(undefined);
    const mockTask3 = vi.fn().mockResolvedValue(undefined);

    const task1 = queue.enqueue(mockTask1, { sessionId: 's1', text: 'payload1' });
    const task2 = queue.enqueue(mockTask2, { sessionId: 's1', text: 'payload2' });
    const task3 = queue.enqueue(mockTask3, { sessionId: 's2', text: 'payload3' });
    task2.catch(() => {});
    task3.catch(() => {});

    const pendingPayloads = queue.extractPending((p) => p.sessionId === 's1');

    await task1;
    await expect(task2).rejects.toThrow('Task extracted for batching');

    expect(pendingPayloads).toEqual([{ sessionId: 's1', text: 'payload2' }]);
    expect(mockTask1).toHaveBeenCalled();
    expect(mockTask2).not.toHaveBeenCalled();

    // task3 should still be executed because it wasn't extracted
    await task3;
    expect(mockTask3).toHaveBeenCalled();
  });
});
