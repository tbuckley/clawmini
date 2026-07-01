// Minimal per-key async mutex. Serializes async critical sections that share
// a key so read-modify-write sequences (load → mutate → save) cannot
// interleave. Used by `DelegationManager` to make state-machine transitions
// and id generation atomic within the single daemon process.
//
// Implementation is the standard "tail promise" chain: each `run` for a key
// awaits the previous run for that key before executing, and installs itself
// as the new tail. Errors are swallowed on the chain (but re-thrown to the
// caller) so one failed section does not wedge the key.
export class KeyedMutex {
  private tails = new Map<string, Promise<void>>();

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const result = prev.then(fn, fn);
    // The chain tail ignores the result/rejection so the next waiter always
    // proceeds; the caller still sees `result`'s resolution/rejection.
    const tail = result.then(
      () => {},
      () => {}
    );
    this.tails.set(key, tail);
    // Drop the entry once this is the last queued section for the key, to keep
    // the map from growing without bound.
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return result;
  }
}
