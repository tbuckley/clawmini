export type Task<T = void> = (signal: AbortSignal) => Promise<T>;

export class Semaphore {
  private count: number;
  private pending: (() => void)[] = [];

  constructor(count: number) {
    this.count = count;
  }

  async acquire(signal?: AbortSignal): Promise<void> {
    if (this.count > 0) {
      this.count--;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      let aborted = false;
      const onAbort = () => {
        aborted = true;
        this.pending = this.pending.filter((p) => p !== resolveFn);
        reject(signal?.reason || new Error('Aborted'));
      };
      const resolveFn = () => {
        if (!aborted) {
          if (signal) signal.removeEventListener('abort', onAbort);
          resolve();
        }
      };
      if (signal) {
        if (signal.aborted) return reject(signal.reason);
        signal.addEventListener('abort', onAbort);
      }
      this.pending.push(resolveFn);
    });
  }

  release(): void {
    if (this.pending.length > 0) {
      const resolveFn = this.pending.shift()!;
      resolveFn();
    } else {
      this.count++;
    }
  }
}

export const subagentSemaphore = new Semaphore(3);

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

  abortCurrent(predicate?: (payload: TPayload) => boolean): void {
    if (this.currentController) {
      if (!predicate || (this.currentPayload !== undefined && predicate(this.currentPayload))) {
        const error = new Error('Task aborted');
        error.name = 'AbortError';
        this.currentController.abort(error);
      }
    }
  }

  getCurrentPayload(): TPayload | undefined {
    return this.currentPayload;
  }

  clear(reason: string = 'Task cleared', predicate?: (payload: TPayload) => boolean): void {
    const tasksToClear = predicate
      ? this.pending.filter((p) => p.payload !== undefined && predicate(p.payload))
      : [...this.pending];

    if (predicate) {
      this.pending = this.pending.filter((p) => !(p.payload !== undefined && predicate(p.payload)));
    } else {
      this.pending = [];
    }

    for (const { reject } of tasksToClear) {
      const error = new Error(reason);
      error.name = 'AbortError';
      reject(error);
    }
  }

  extractPending(predicate?: (payload: TPayload) => boolean): TPayload[] {
    const extracted = this.pending
      .map((p) => p.payload)
      .filter((p): p is TPayload => p !== undefined && (!predicate || predicate(p)));

    this.clear('Task extracted for batching', predicate);

    return extracted;
  }
}

export interface MessageQueuePayload {
  text: string;
  sessionId: string;
}

const messageQueues = new Map<string, Queue<MessageQueuePayload>>();

export function getMessageQueue(chatId: string): Queue<MessageQueuePayload> {
  if (!messageQueues.has(chatId)) {
    messageQueues.set(chatId, new Queue<MessageQueuePayload>());
  }
  return messageQueues.get(chatId)!;
}

export function isSessionIdActive(sessionId: string): boolean {
  for (const queue of messageQueues.values()) {
    const isPending = queue['pending'].some((p) => p.payload?.sessionId === sessionId);
    const isRunning = queue.getCurrentPayload()?.sessionId === sessionId;
    if (isPending || isRunning) {
      return true;
    }
  }
  return false;
}

export function abortQueuesForSessionId(sessionId: string): void {
  for (const queue of messageQueues.values()) {
    queue.extractPending((p) => p.sessionId === sessionId);
    queue.abortCurrent((p) => p.sessionId === sessionId);
  }
}

export function abortQueuesForChat(targetChatId: string): void {
  for (const [chatId, queue] of messageQueues.entries()) {
    if (chatId === targetChatId || chatId.startsWith(targetChatId + ':subagents:')) {
      queue.abortCurrent();
      queue.clear('Parent chat deleted');
      messageQueues.delete(chatId);
    }
  }
}
