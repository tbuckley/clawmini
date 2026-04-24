import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

import { getSocketPath } from '../shared/workspace.js';

export type ServiceName = 'daemon' | 'web' | 'adapter-discord' | 'adapter-google-chat';

export const DISPLAY_NAMES: Record<ServiceName, string> = {
  daemon: 'daemon',
  web: 'web',
  'adapter-discord': 'discord',
  'adapter-google-chat': 'google-chat',
};

interface ResolvedCommand {
  command: string;
  args: string[];
}

export function resolveServiceCommand(service: ServiceName): ResolvedCommand {
  const cliPath = fileURLToPath(import.meta.url);
  switch (service) {
    case 'daemon':
      return {
        command: process.execPath,
        args: [new URL('../daemon/index.mjs', import.meta.url).pathname],
      };
    case 'web':
      return { command: process.execPath, args: [cliPath, 'web'] };
    case 'adapter-discord':
      return {
        command: process.execPath,
        args: [new URL('../adapter-discord/index.mjs', import.meta.url).pathname],
      };
    case 'adapter-google-chat':
      return {
        command: process.execPath,
        args: [new URL('../adapter-google-chat/index.mjs', import.meta.url).pathname],
      };
  }
}

export class Supervisor {
  private children = new Map<ServiceName, ChildProcess>();
  private logFds = new Map<ServiceName, number>();
  private shuttingDown = false;
  private readonly logDir: string;

  constructor(logDir: string) {
    this.logDir = logDir;
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  }

  async startService(service: ServiceName): Promise<void> {
    const { command, args } = resolveServiceCommand(service);
    const logPath = path.join(this.logDir, `${service}.log`);
    const logFd = fs.openSync(logPath, 'a');
    this.logFds.set(service, logFd);

    fs.writeSync(
      logFd,
      `\n--- clawmini serve: ${service} starting at ${new Date().toISOString()} ---\n`
    );

    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
      cwd: process.cwd(),
    });

    this.children.set(service, child);
    this.attachPipe(service, child.stdout!, logFd, 'stdout');
    this.attachPipe(service, child.stderr!, logFd, 'stderr');

    child.on('exit', (code, signal) => {
      const msg = `exited code=${code} signal=${signal}`;
      process.stderr.write(`[${DISPLAY_NAMES[service]}] ${msg}\n`);
      try {
        fs.writeSync(logFd, `--- ${msg} at ${new Date().toISOString()} ---\n`);
        fs.closeSync(logFd);
      } catch {
        // best-effort
      }
      this.logFds.delete(service);
      this.children.delete(service);

      if (service === 'daemon' && !this.shuttingDown) {
        process.stderr.write('[supervisor] daemon exited unexpectedly — shutting down\n');
        void this.shutdown(1);
      }
    });
  }

  private attachPipe(
    service: ServiceName,
    stream: NodeJS.ReadableStream,
    logFd: number,
    kind: 'stdout' | 'stderr'
  ): void {
    const prefix = `[${DISPLAY_NAMES[service]}] `;
    const target = kind === 'stderr' ? process.stderr : process.stdout;
    const rl = readline.createInterface({ input: stream });
    rl.on('line', (line) => {
      try {
        fs.writeSync(logFd, line + '\n');
      } catch {
        // best-effort: logs on disk are not critical
      }
      target.write(prefix + line + '\n');
    });
  }

  async waitForDaemonSocket(timeoutMs = 10_000): Promise<void> {
    const socketPath = getSocketPath();
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (fs.existsSync(socketPath)) return;
      if (!this.children.has('daemon')) {
        throw new Error('Daemon exited before socket became available.');
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`Daemon did not start within ${timeoutMs}ms`);
  }

  async shutdown(exitCode = 0): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    process.stderr.write('\n[supervisor] shutting down...\n');

    const stops: Promise<void>[] = [];
    for (const [name, child] of this.children) {
      stops.push(Supervisor.terminateChild(name, child));
    }
    await Promise.allSettled(stops);

    for (const fd of this.logFds.values()) {
      try {
        fs.closeSync(fd);
      } catch {
        // best-effort
      }
    }
    this.logFds.clear();

    process.exit(exitCode);
  }

  private static terminateChild(name: ServiceName, child: ChildProcess): Promise<void> {
    return new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve();
        return;
      }
      const timer = setTimeout(() => {
        process.stderr.write(`[supervisor] ${name} did not exit in 10s, sending SIGKILL\n`);
        try {
          child.kill('SIGKILL');
        } catch {
          // ignore
        }
      }, 10_000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      try {
        child.kill('SIGTERM');
      } catch {
        clearTimeout(timer);
        resolve();
      }
    });
  }
}
