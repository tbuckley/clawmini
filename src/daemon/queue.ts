export type Task<T = void> = (signal: AbortSignal) => Promise<T>;

interface QueueEntry {
  task: Task;
  textPayload?: string | undefined;
  resolve: (value: void | PromiseLike<void>) => void;
  reject: (reason?: unknown) => void;
}

export class Queue {
  private pending: QueueEntry[] = [];
  private isRunning = false;
  private currentController: AbortController | null = null;

  enqueue(task: Task, textPayload?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.pending.push({ task, textPayload, resolve, reject });
      // We don't await processNext because we want enqueue to return the task's promise
      // and let processNext run in the background.
      this.processNext().catch(() => {});
    });
  }

  private async processNext() {
    if (this.isRunning || this.pending.length === 0) return;

    this.isRunning = true;
    const entry = this.pending.shift()!;
    this.currentController = new AbortController();

    try {
      await entry.task(this.currentController.signal);
      entry.resolve();
    } catch (error) {
      entry.reject(error);
    } finally {
      this.isRunning = false;
      this.currentController = null;
      // Continue processing the next item
      this.processNext().catch(() => {});
    }
  }

  abortCurrent(): void {
    if (this.currentController) {
      const error = new Error('Task aborted');
      error.name = 'AbortError';
      this.currentController.abort(error);
    }
  }

  clear(): void {
    const tasksToClear = [...this.pending];
    this.pending = [];
    for (const { reject } of tasksToClear) {
      const error = new Error('Task cleared');
      error.name = 'AbortError';
      reject(error);
    }
  }

  extractPending(): string[] {
    const extracted = this.pending
      .map((p) => p.textPayload)
      .filter((text): text is string => text !== undefined);

    const tasksToClear = [...this.pending];
    this.pending = [];

    for (const { reject } of tasksToClear) {
      const error = new Error('Task extracted for batching');
      error.name = 'AbortError';
      reject(error);
    }

    return extracted;
  }
}

const directoryQueues = new Map<string, Queue>();

export function getQueue(dir: string): Queue {
  if (!directoryQueues.has(dir)) {
    directoryQueues.set(dir, new Queue());
  }
  return directoryQueues.get(dir)!;
}
