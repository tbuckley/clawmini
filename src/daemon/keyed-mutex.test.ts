import { describe, it, expect } from 'vitest';
import { KeyedMutex } from './keyed-mutex.js';

describe('KeyedMutex', () => {
  it('serializes sections that share a key', async () => {
    const mutex = new KeyedMutex();
    const events: string[] = [];
    const section = (label: string) =>
      mutex.run('k', async () => {
        events.push(`${label}:start`);
        await new Promise((r) => setTimeout(r, 10));
        events.push(`${label}:end`);
      });

    await Promise.all([section('a'), section('b'), section('c')]);

    // No interleaving: each start is immediately followed by its own end.
    expect(events).toEqual(['a:start', 'a:end', 'b:start', 'b:end', 'c:start', 'c:end']);
  });

  it('runs sections for different keys concurrently', async () => {
    const mutex = new KeyedMutex();
    const events: string[] = [];
    const section = (key: string, label: string) =>
      mutex.run(key, async () => {
        events.push(`${label}:start`);
        await new Promise((r) => setTimeout(r, 10));
        events.push(`${label}:end`);
      });

    await Promise.all([section('x', 'a'), section('y', 'b')]);

    // Both started before either finished.
    expect(events.slice(0, 2).sort()).toEqual(['a:start', 'b:start']);
  });

  it('does not wedge a key when a section throws', async () => {
    const mutex = new KeyedMutex();
    await expect(mutex.run('k', async () => Promise.reject(new Error('boom')))).rejects.toThrow(
      'boom'
    );
    // The next section for the same key still runs.
    const result = await mutex.run('k', async () => 42);
    expect(result).toBe(42);
  });
});
