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

// Adapters and the web UI are mostly stateless — give them a tight window.
// The daemon runs `down` hooks (e.g. sandbox/container teardown) that can
// legitimately take tens of seconds, so it needs much longer to drain.
const ADAPTER_TERMINATE_TIMEOUT_MS = 10_000;
const DAEMON_TERMINATE_TIMEOUT_MS = 60_000;

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
  private restarting = new Set<ServiceName>();
  // Services that have ever been started in this supervisor's lifetime. Used
  // by restartAll() to know what to bring back after a stopAllChildren().
  // We don't remove entries when a service stops — a crash-and-restart of an
  // adapter shouldn't drop it from the "originally enabled" set.
  private enabledServices = new Set<ServiceName>();
  private readonly logDir: string;

  constructor(logDir: string) {
    this.logDir = logDir;
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  }

  async startService(service: ServiceName): Promise<void> {
    this.enabledServices.add(service);
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

      if (service === 'daemon' && !this.shuttingDown && !this.restarting.has('daemon')) {
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

    await this.stopAllChildren();

    process.exit(exitCode);
  }

  /**
   * Stop all children and close log fds without exiting the process. Used by
   * `/upgrade`, which needs to tear down everything, run an install, then
   * launch a fresh supervisor.
   */
  async stopAllChildren(): Promise<void> {
    // Phase 1: stop adapters and the web UI in parallel. They depend on the
    // daemon, so taking them down first lets the daemon's `down` hooks run
    // without interference from disconnect noise.
    const adapterStops: Promise<void>[] = [];
    for (const [name, child] of this.children) {
      if (name === 'daemon') continue;
      adapterStops.push(Supervisor.terminateChild(name, child, ADAPTER_TERMINATE_TIMEOUT_MS));
    }
    await Promise.allSettled(adapterStops);

    // Phase 2: stop the daemon with a generous timeout so its `down` hooks
    // (sandbox/container teardown) can complete.
    const daemonChild = this.children.get('daemon');
    if (daemonChild) {
      await Supervisor.terminateChild('daemon', daemonChild, DAEMON_TERMINATE_TIMEOUT_MS);
    }

    for (const fd of this.logFds.values()) {
      try {
        fs.closeSync(fd);
      } catch {
        // best-effort
      }
    }
    this.logFds.clear();
  }

  /**
   * Bounce every service that has ever been started under this supervisor.
   * Daemon goes down with the adapters, then comes back first so the
   * adapters can re-establish their tRPC subscriptions to the new daemon.
   *
   * This is what `/restart` and the `/upgrade` failure recovery paths call:
   * just bouncing the daemon would leave adapter-discord (and any other
   * adapter) holding a dead subscription, so outbound messages would never
   * reach the chat. The user-visible symptom was "I send /restart and then
   * the daemon's reply never shows up in Discord."
   */
  async restartAll(): Promise<void> {
    if (this.shuttingDown) return;
    // Suppress the daemon's unexpected-exit guard while we tear it down.
    this.restarting.add('daemon');
    try {
      await this.stopAllChildren();
      // Wait for the exit handlers to drain bookkeeping.
      await new Promise((r) => setImmediate(r));

      if (this.enabledServices.has('daemon')) {
        await this.startService('daemon');
        await this.waitForDaemonSocket();
      }
      for (const name of this.enabledServices) {
        if (name === 'daemon') continue;
        await this.startService(name);
      }
    } finally {
      this.restarting.delete('daemon');
    }
  }

  /**
   * Stop and re-spawn a single service. The exit handler is suppressed so a
   * restarted daemon doesn't trigger a full shutdown.
   */
  async restartService(service: ServiceName): Promise<void> {
    if (this.shuttingDown) return;
    this.restarting.add(service);
    try {
      const child = this.children.get(service);
      if (child) {
        const timeoutMs =
          service === 'daemon' ? DAEMON_TERMINATE_TIMEOUT_MS : ADAPTER_TERMINATE_TIMEOUT_MS;
        await Supervisor.terminateChild(service, child, timeoutMs);
      }
      // Wait until the exit handler has cleared bookkeeping. The handler runs
      // synchronously on the same tick as `exit`, so a microtask hop is enough.
      await new Promise((r) => setImmediate(r));
      await this.startService(service);
      if (service === 'daemon') {
        await this.waitForDaemonSocket();
      }
    } finally {
      this.restarting.delete(service);
    }
  }

  private static terminateChild(
    name: ServiceName,
    child: ChildProcess,
    timeoutMs: number
  ): Promise<void> {
    return new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve();
        return;
      }
      const timer = setTimeout(() => {
        process.stderr.write(
          `[supervisor] ${name} did not exit in ${Math.round(timeoutMs / 1000)}s, sending SIGKILL\n`
        );
        try {
          child.kill('SIGKILL');
        } catch {
          // ignore
        }
      }, timeoutMs);
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
