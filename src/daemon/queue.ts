export type Task<T = void> = (signal: AbortSignal) => Promise<T>;

interface QueueEntry<TPayload = string> {
  task: Task;
  payload?: TPayload | undefined;
  resolve: (value: void | PromiseLike<void>) => void;
  reject: (reason?: unknown) => void;
}

export class Queue<TPayload = string> {
  private pending: QueueEntry<TPayload>[] = [];
  private isRunning = false;
  private currentController: AbortController | null = null;
  private currentPayload?: TPayload | undefined;

  enqueue(task: Task, payload?: TPayload): Promise<void> {
    return new Promise((resolve, reject) => {
      this.pending.push({ task, payload, resolve, reject });
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
    this.currentPayload = entry.payload;

    try {
      await entry.task(this.currentController.signal);
      entry.resolve();
    } catch (error) {
      entry.reject(error);
    } finally {
      this.isRunning = false;
      this.currentController = null;
      this.currentPayload = undefined;
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

  getCurrentPayload(): TPayload | undefined {
    return this.currentPayload;
  }

  clear(reason: string = 'Task cleared'): void {
    const tasksToClear = [...this.pending];
    this.pending = [];
    for (const { reject } of tasksToClear) {
      const error = new Error(reason);
      error.name = 'AbortError';
      reject(error);
    }
  }

  extractPending(): TPayload[] {
    const extracted = this.pending
      .map((p) => p.payload)
      .filter((p): p is TPayload => p !== undefined);

    this.clear('Task extracted for batching');

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
