export interface AgentTask {
  id: string;
  rootChatId: string;
  dirPath: string;
  sessionId: string;
  text?: string;
  execute: (signal: AbortSignal) => Promise<void>;
}

class ResourceLock {
  private resources = new Map<
    string,
    {
      activeWorkspace: string;
      count: number;
      waiters: Array<{
        workspaceId: string;
        resolve: () => void;
        reject: (err: Error) => void;
      }>;
    }
  >();

  async acquire(resourceId: string, workspaceId: string, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      const error = new Error('Task aborted');
      error.name = 'AbortError';
      throw error;
    }

    const res = this.resources.get(resourceId);
    if (!res) {
      this.resources.set(resourceId, { activeWorkspace: workspaceId, count: 1, waiters: [] });
      return;
    }

    if (res.activeWorkspace === workspaceId) {
      // Allow re-entrancy for the same rootChatId (workspaceId) so that the
      // root agent and its subagents can run in parallel in the same directory.
      // This ensures the root agent remains available to coordinate its subagents,
      // assuming it will manage conflicts appropriately.
      // Note: This risks starvation if agents/subagents from this workspace never release the resource.
      res.count++;
      return;
    }

    return new Promise<void>((resolve, reject) => {
      const waiter = { workspaceId, resolve, reject };
      res!.waiters.push(waiter);

      if (signal) {
        const onAbort = () => {
          const idx = res!.waiters.indexOf(waiter);
          if (idx !== -1) {
            res!.waiters.splice(idx, 1);
            const error = new Error('Task aborted');
            error.name = 'AbortError';
            reject(error);
          }
        };
        signal.addEventListener('abort', onAbort);

        // Intercept resolve to clean up the listener
        waiter.resolve = () => {
          signal.removeEventListener('abort', onAbort);
          resolve();
        };
        // Intercept reject to clean up the listener
        waiter.reject = (err: Error) => {
          signal.removeEventListener('abort', onAbort);
          reject(err);
        };
      }
    });
  }

  release(resourceId: string, _workspaceId: string) {
    const res = this.resources.get(resourceId);
    if (!res) return;

    res.count--;
    if (res.count === 0) {
      if (res.waiters.length > 0) {
        const nextWorkspace = res.waiters[0]!.workspaceId;
        res.activeWorkspace = nextWorkspace;

        const remainingWaiters = [];
        for (const waiter of res.waiters) {
          if (waiter.workspaceId === nextWorkspace) {
            res.count++;
            waiter.resolve();
          } else {
            remainingWaiters.push(waiter);
          }
        }
        res.waiters = remainingWaiters;
      } else {
        this.resources.delete(resourceId);
      }
    }
  }
}

class TaskQueue {
  private queue: Array<{
    task: AgentTask;
    resolve: () => void;
    reject: (err: unknown) => void;
  }> = [];
  private activeTask: { task: AgentTask; controller: AbortController } | null = null;
  private isProcessing = false;

  constructor(
    public readonly sessionId: string,
    private resourceLock: ResourceLock,
    private onEmpty: (sessionId: string) => void
  ) {}

  enqueue(task: AgentTask): Promise<void> {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this.process();
    });
  }

  private async process() {
    if (this.isProcessing || this.activeTask || this.queue.length === 0) return;
    this.isProcessing = true;

    while (this.queue.length > 0) {
      const next = this.queue.shift()!;
      const controller = new AbortController();
      this.activeTask = { task: next.task, controller };

      let acquired = false;
      try {
        await this.resourceLock.acquire(next.task.dirPath, next.task.rootChatId, controller.signal);
        acquired = true;

        if (!controller.signal.aborted) {
          await next.task.execute(controller.signal);
        }
        next.resolve();
      } catch (err) {
        next.reject(err);
      } finally {
        if (acquired) {
          this.resourceLock.release(next.task.dirPath, next.task.rootChatId);
        }
        this.activeTask = null;
      }
    }

    this.isProcessing = false;
    this.onEmpty(this.sessionId);
  }

  abortAll() {
    const error = new Error('Task aborted');
    error.name = 'AbortError';

    if (this.activeTask) {
      this.activeTask.controller.abort(error);
    }

    for (const qTask of this.queue) {
      qTask.reject(error);
    }
    this.queue = [];
  }

  interruptAndExtract(): string[] {
    const payloads: string[] = [];

    const error = new Error('Task aborted');
    error.name = 'AbortError';

    if (this.activeTask) {
      if (this.activeTask.task.text !== undefined) {
        payloads.push(this.activeTask.task.text);
      }
      this.activeTask.controller.abort(error);
    }

    for (const qTask of this.queue) {
      if (qTask.task.text !== undefined) {
        payloads.push(qTask.task.text);
      }
      qTask.reject(error);
    }
    this.queue = [];

    return payloads;
  }

  extractPending(): string[] {
    const payloads: string[] = [];

    const error = new Error('Task extracted for batching');
    error.name = 'AbortError';

    for (const qTask of this.queue) {
      if (qTask.task.text !== undefined) {
        payloads.push(qTask.task.text);
      }
      qTask.reject(error);
    }
    this.queue = [];

    return payloads;
  }

  hasTasks(): boolean {
    return this.activeTask !== null || this.queue.length > 0;
  }
}

export class TaskScheduler {
  private queues = new Map<string, TaskQueue>();
  private resourceLock = new ResourceLock();

  private getQueueKey(sessionId: string, rootChatId: string): string {
    return `${rootChatId}:${sessionId}`;
  }

  public schedule(task: AgentTask): Promise<void> {
    const key = this.getQueueKey(task.sessionId, task.rootChatId);
    let queue = this.queues.get(key);
    if (!queue) {
      queue = new TaskQueue(task.sessionId, this.resourceLock, () => {
        this.queues.delete(key);
      });
      this.queues.set(key, queue);
    }
    return queue.enqueue(task);
  }

  public hasTasks(sessionId: string): boolean {
    for (const queue of this.queues.values()) {
      if (queue.sessionId === sessionId && queue.hasTasks()) {
        return true;
      }
    }
    return false;
  }

  public extractPending(sessionId: string): string[] {
    const payloads: string[] = [];
    for (const queue of this.queues.values()) {
      if (queue.sessionId === sessionId) {
        payloads.push(...queue.extractPending());
      }
    }
    return payloads;
  }

  public abortTasks(sessionId: string): void {
    for (const queue of this.queues.values()) {
      if (queue.sessionId === sessionId) {
        queue.abortAll();
      }
    }
  }

  public interruptTasks(sessionId: string): string[] {
    const payloads: string[] = [];
    for (const queue of this.queues.values()) {
      if (queue.sessionId === sessionId) {
        payloads.push(...queue.interruptAndExtract());
      }
    }
    return payloads;
  }
}

export const taskScheduler = new TaskScheduler();
