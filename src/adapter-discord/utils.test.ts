import { describe, it, expect, vi } from 'vitest';
import { Debouncer } from './utils.js';

describe('Debouncer', () => {
  it('should debounce calls and group items', async () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const debouncer = new Debouncer(1000, callback);

    debouncer.add('a');
    debouncer.add('b');
    debouncer.add('c');

    expect(callback).not.toBeCalled();

    vi.advanceTimersByTime(500);
    debouncer.add('d');
    expect(callback).not.toBeCalled();

    vi.advanceTimersByTime(1000);
    expect(callback).toBeCalledTimes(1);
    expect(callback).toBeCalledWith(['a', 'b', 'c', 'd']);

    vi.useRealTimers();
  });

  it('should call callback again for subsequent items', async () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const debouncer = new Debouncer(1000, callback);

    debouncer.add('a');
    vi.advanceTimersByTime(1000);
    expect(callback).toBeCalledTimes(1);
    expect(callback).toBeCalledWith(['a']);

    debouncer.add('b');
    vi.advanceTimersByTime(1000);
    expect(callback).toBeCalledTimes(2);
    expect(callback).toBeCalledWith(['b']);

    vi.useRealTimers();
  });

  it('should discard duplicate items to handle duplicate deliveries', async () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const debouncer = new Debouncer(1000, callback);

    debouncer.add('a');
    debouncer.add('b');
    debouncer.add('a'); // This should be discarded

    vi.advanceTimersByTime(1000);
    expect(callback).toBeCalledTimes(1);
    expect(callback).toBeCalledWith(['a', 'b']);

    vi.useRealTimers();
  });

  it('should flush items immediately', async () => {
    const callback = vi.fn();
    const debouncer = new Debouncer(1000, callback);

    debouncer.add('a');
    debouncer.add('b');
    debouncer.flush();

    expect(callback).toBeCalledTimes(1);
    expect(callback).toBeCalledWith(['a', 'b']);
  });
});
