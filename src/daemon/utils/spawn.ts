import { spawn } from 'node:child_process';
import type { RunCommandFn } from '../message.js';

const LOG_TO_TERMINAL = true;

export const runCommand: RunCommandFn = async ({
  command,
  cwd,
  env,
  stdin,
  signal,
}: Parameters<RunCommandFn>[0] & { logToTerminal?: boolean }) => {
  return new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve, reject) => {
    const p = spawn(command, { shell: true, cwd, env, signal });

    if (stdin && p.stdin) {
      p.stdin.on('error', (err) => {
        if ((err as NodeJS.ErrnoException).code !== 'EPIPE') {
          console.error('stdin error:', err);
        }
      });
      p.stdin.write(stdin);
      p.stdin.end();
    }

    let stdout = '';
    let stderr = '';

    if (p.stdout) {
      p.stdout.on('data', (data) => {
        stdout += data.toString();
        if (LOG_TO_TERMINAL && !stdin) {
          process.stdout.write(data);
        }
      });
    }

    if (p.stderr) {
      p.stderr.on('data', (data) => {
        stderr += data.toString();
        if (LOG_TO_TERMINAL && !stdin) {
          process.stderr.write(data);
        }
      });
    }

    p.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });

    p.on('error', (err) => {
      if (err.name === 'AbortError') {
        reject(err);
        return;
      }
      resolve({ stdout: '', stderr: err.toString(), exitCode: 1 });
    });
  });
};
