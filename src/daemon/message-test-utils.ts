/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi } from 'vitest';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';

export const runCommandCallback = async ({ command, cwd, env, stdin }: any) => {
  return new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve) => {
    const p = spawn(command, { shell: true, cwd, env });
    if (stdin) {
      if (p.stdin) {
        p.stdin.write(stdin);
        p.stdin.end();
      }
    }
    let stdout = '';
    let stderr = '';
    if (p.stdout) p.stdout.on('data', (data: any) => (stdout += data.toString()));
    if (p.stderr) p.stderr.on('data', (data: any) => (stderr += data.toString()));
    p.on('close', (code: any) => resolve({ stdout, stderr, exitCode: code ?? 1 }));
    p.on('error', (err: any) => resolve({ stdout: '', stderr: err.toString(), exitCode: 1 }));
  });
};

export function createMockSpawn() {
  const mockSpawn = vi.fn().mockImplementation((_cmd, _options) => {
    const emitter = new EventEmitter() as any;
    emitter.stdout = new EventEmitter();
    emitter.stderr = new EventEmitter();
    emitter.stdin = { write: vi.fn(), end: vi.fn() };

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
    emitter.stdin = { write: vi.fn(), end: vi.fn() };
    emitter.finish = (code: number) => emitter.emit('close', code);
    setTimeout(() => emitter.finish(0), 0);
    return emitter;
  });
  return mockSpawn;
}
