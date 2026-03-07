/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi } from 'vitest';
import { EventEmitter } from 'node:events';

export { runCommand as runCommandCallback } from './utils/spawn.js';

export function createMockSpawn() {
  const mockSpawn = vi.fn().mockImplementation((_cmd, _options) => {
    const emitter = new EventEmitter() as any;
    emitter.stdout = new EventEmitter();
    emitter.stderr = new EventEmitter();
    emitter.stdin = { write: vi.fn(), end: vi.fn(), on: vi.fn() };

    emitter.finish = (code: number) => {
      emitter.emit('close', code);
    };

    emitter.fail = (err: Error) => {
      emitter.emit('error', err);
    };

    (mockSpawn as any).emitters = (mockSpawn as any).emitters || [];
    (mockSpawn as any).emitters.push(emitter);
    (mockSpawn as any).lastEmitter = emitter;
    return emitter;
  });
  return mockSpawn;
}

export function createAutoFinishMockSpawn() {
  const mockSpawn = vi.fn().mockImplementation(() => {
    const emitter = new EventEmitter() as any;
    emitter.stdout = new EventEmitter();
    emitter.stderr = new EventEmitter();
    emitter.stdin = { write: vi.fn(), end: vi.fn(), on: vi.fn() };
    emitter.finish = (code: number) => emitter.emit('close', code);
    setTimeout(() => emitter.finish(0), 0);
    return emitter;
  });
  return mockSpawn;
}
