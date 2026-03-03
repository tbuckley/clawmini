export class Debouncer<T> {
  private timeout: NodeJS.Timeout | null = null;
  private buffer: T[] = [];

  constructor(
    private delay: number,
    private callback: (items: T[]) => Promise<void> | void
  ) {}

  add(item: T) {
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
