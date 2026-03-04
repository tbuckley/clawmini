export class Debouncer<T> {
  private timeout: NodeJS.Timeout | null = null;
  private buffer: T[] = [];
  private history: T[] = [];
  private readonly historyLimit = 100;

  constructor(
    private delay: number,
    private callback: (items: T[]) => Promise<void> | void,
    private isEqual: (a: T, b: T) => boolean = (a, b) => a === b
  ) {}

  add(item: T) {
    if (this.history.find((h) => this.isEqual(h, item))) {
      return;
    }

    this.history.push(item);
    if (this.history.length > this.historyLimit) {
      this.history.shift();
    }

    this.buffer.push(item);

    if (this.timeout) {
      clearTimeout(this.timeout);
    }

    this.timeout = setTimeout(async () => {
      const itemsToProcess = [...this.buffer];
      this.buffer = [];
      this.timeout = null;
      await this.callback(itemsToProcess);
    }, this.delay);
  }

  flush() {
    if (this.timeout) {
      clearTimeout(this.timeout);
      const itemsToProcess = [...this.buffer];
      this.buffer = [];
      this.timeout = null;
      this.callback(itemsToProcess);
    }
  }
}
