export interface AgentTask {
  id: string;
  rootChatId: string;
  dirPath: string;
  sessionId: string;
  text?: string;
  execute: (signal: AbortSignal) => Promise<void>;
}

interface QueuedTask {
  task: AgentTask;
  resolve: () => void;
  reject: (err: unknown) => void;
  queuedAt: number;
}

export class TaskScheduler {
  public MAX_CONCURRENT_AGENTS = 5;

  private queue: QueuedTask[] = [];
  private activeTasks = new Map<string, { task: AgentTask; controller: AbortController }>();
  private blockedTasks = new Set<string>();

  // resource locks
  // We keep track of how many tasks are using a resource, or just track ownership.
  // Actually, for a lock map, we can map resource ID to the task ID holding it.
  // BUT to allow subagents to run when parent is blocked, blocked tasks release their locks.
  private dirLocks = new Map<string, string>(); // dirPath -> taskId
  private rootChatLocks = new Map<string, string>(); // rootChatId -> taskId

  // queue for tasks waiting to be unblocked
  private unblockQueue: Array<{ taskId: string; resolve: () => void }> = [];

  public schedule(task: AgentTask): Promise<void> {
    return new Promise((resolve, reject) => {
      this.queue.push({
        task,
        resolve,
        reject,
        queuedAt: Date.now(),
      });
      this.processQueue();
    });
  }

  public extractPending(sessionId: string): string[] {
    const payloads: string[] = [];
    const remainingQueue: QueuedTask[] = [];

    const error = new Error('Task extracted for batching');
    error.name = 'AbortError';

    for (const qTask of this.queue) {
      if (qTask.task.sessionId === sessionId) {
        if (qTask.task.text !== undefined) payloads.push(qTask.task.text);
        qTask.reject(error);
      } else {
        remainingQueue.push(qTask);
      }
    }
    this.queue = remainingQueue;

    return payloads;
  }

  public abortTasks(sessionId: string): void {
    const error = new Error('Task aborted');
    error.name = 'AbortError';

    // Abort active tasks
    for (const { task, controller } of this.activeTasks.values()) {
      if (task.sessionId === sessionId) {
        controller.abort(error);
      }
    }

    // Remove and reject pending tasks
    const remainingQueue: QueuedTask[] = [];
    for (const qTask of this.queue) {
      if (qTask.task.sessionId === sessionId) {
        qTask.reject(error);
      } else {
        remainingQueue.push(qTask);
      }
    }
    this.queue = remainingQueue;
  }

  public interruptTasks(sessionId: string): string[] {
    const payloads: string[] = [];

    // Abort active tasks and collect text
    const error = new Error('Task aborted');
    error.name = 'AbortError';

    for (const { task, controller } of this.activeTasks.values()) {
      if (task.sessionId === sessionId) {
        if (task.text !== undefined) payloads.push(task.text);
        controller.abort(error);
      }
    }

    // Remove pending tasks, reject them, and collect text
    const remainingQueue: QueuedTask[] = [];
    for (const qTask of this.queue) {
      if (qTask.task.sessionId === sessionId) {
        if (qTask.task.text !== undefined) payloads.push(qTask.task.text);
        qTask.reject(error);
      } else {
        remainingQueue.push(qTask);
      }
    }
    this.queue = remainingQueue;

    return payloads;
  }

  public markBlocked(taskId: string) {
    const active = this.activeTasks.get(taskId);
    if (!active) return;
    this.blockedTasks.add(taskId);
    this.releaseLocks(active.task);
    this.processQueue();
  }

  public markUnblocked(taskId: string): Promise<void> {
    return new Promise((resolve) => {
      this.unblockQueue.push({ taskId, resolve });
      this.processQueue();
    });
  }

  private processQueue() {
    this.processUnblockQueue();

    // pool expansion: activeTasks.size - blockedTasks.size
    const effectiveActiveCount = this.activeTasks.size - this.blockedTasks.size;
    let availableSlots = this.MAX_CONCURRENT_AGENTS - effectiveActiveCount;

    if (availableSlots <= 0) return;

    // To prevent starvation, we iterate from oldest to newest.
    // We only process tasks that can acquire locks.
    const toStart: QueuedTask[] = [];
    const remainingQueue: QueuedTask[] = [];

    for (const qTask of this.queue) {
      if (availableSlots > 0 && this.canAcquireLocks(qTask.task)) {
        this.acquireLocks(qTask.task);
        toStart.push(qTask);
        availableSlots--;
      } else {
        remainingQueue.push(qTask);
      }
    }

    this.queue = remainingQueue;

    for (const qTask of toStart) {
      this.runTask(qTask);
    }
  }

  private processUnblockQueue() {
    const remaining: typeof this.unblockQueue = [];
    for (const item of this.unblockQueue) {
      const active = this.activeTasks.get(item.taskId);
      if (active && this.canAcquireLocks(active.task)) {
        this.acquireLocks(active.task);
        this.blockedTasks.delete(item.taskId);
        item.resolve();
      } else {
        remaining.push(item);
      }
    }
    this.unblockQueue = remaining;
  }

  private async runTask(qTask: QueuedTask) {
    const controller = new AbortController();
    this.activeTasks.set(qTask.task.id, { task: qTask.task, controller });
    try {
      await qTask.task.execute(controller.signal);
      qTask.resolve();
    } catch (err) {
      qTask.reject(err);
    } finally {
      this.activeTasks.delete(qTask.task.id);
      this.blockedTasks.delete(qTask.task.id);
      this.releaseLocks(qTask.task);
      this.processQueue();
    }
  }

  private canAcquireLocks(task: AgentTask): boolean {
    if (this.dirLocks.has(task.dirPath) && this.dirLocks.get(task.dirPath) !== task.id) {
      return false;
    }
    if (
      this.rootChatLocks.has(task.rootChatId) &&
      this.rootChatLocks.get(task.rootChatId) !== task.id
    ) {
      return false;
    }
    return true;
  }

  private acquireLocks(task: AgentTask) {
    this.dirLocks.set(task.dirPath, task.id);
    this.rootChatLocks.set(task.rootChatId, task.id);
  }

  private releaseLocks(task: AgentTask) {
    if (this.dirLocks.get(task.dirPath) === task.id) {
      this.dirLocks.delete(task.dirPath);
    }
    if (this.rootChatLocks.get(task.rootChatId) === task.id) {
      this.rootChatLocks.delete(task.rootChatId);
    }
  }
}

export const taskScheduler = new TaskScheduler();
