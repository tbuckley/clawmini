import { Command } from 'commander';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

import { getClawminiDir, getSocketPath } from '../../shared/workspace.js';
import { installBuiltinPolicies } from '../builtin-policies.js';
import { exportLiteToAllEnvironments } from '../../shared/lite.js';
import { ensureDefaultPoliciesFile, refreshAllAgents } from './up.js';
import { getDiscordConfigPath } from '../../adapter-discord/config.js';
import { getGoogleChatConfigPath } from '../../adapter-google-chat/config.js';
import {
  getSupervisorPidPath,
  readSupervisorPid,
  removeSupervisorPid,
  writeSupervisorPid,
} from '../supervisor-pid.js';
import { Supervisor, type ServiceName } from '../supervisor.js';

const ALL_SERVICES: ServiceName[] = ['daemon', 'web', 'adapter-discord', 'adapter-google-chat'];

const SERVICE_ALIASES: Record<string, ServiceName> = {
  daemon: 'daemon',
  web: 'web',
  discord: 'adapter-discord',
  'adapter-discord': 'adapter-discord',
  'google-chat': 'adapter-google-chat',
  'adapter-google-chat': 'adapter-google-chat',
};

interface ResolveInput {
  only?: string | undefined;
  exclude?: string | undefined;
  adapterConfigPresent?: Partial<Record<ServiceName, boolean>> | undefined;
}

// Exported for unit tests.
export function resolveEnabledServices(opts: ResolveInput): ServiceName[] {
  const parseList = (csv: string | undefined): ServiceName[] => {
    if (!csv) return [];
    const names = csv
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return names.map((name) => {
      const resolved = SERVICE_ALIASES[name];
      if (!resolved) {
        throw new Error(
          `Unknown service: '${name}'. Valid: ${Object.keys(SERVICE_ALIASES).join(', ')}`
        );
      }
      return resolved;
    });
  };

  const configPresent: Record<ServiceName, boolean> = {
    daemon: true,
    web: true,
    'adapter-discord': false,
    'adapter-google-chat': false,
    ...(opts.adapterConfigPresent ?? {}),
  };

  const excluded = new Set(parseList(opts.exclude));

  const only = parseList(opts.only);
  if (only.length > 0) {
    return only.filter((n) => !excluded.has(n));
  }

  return ALL_SERVICES.filter((n) => configPresent[n] && !excluded.has(n));
}

async function runPreStart(): Promise<void> {
  await installBuiltinPolicies();
  ensureDefaultPoliciesFile();
  await exportLiteToAllEnvironments();
  await refreshAllAgents();
}

interface ServeOptions {
  detach?: boolean;
  only?: string;
  exclude?: string;
}

async function runForeground(enabled: ServiceName[]): Promise<void> {
  const logDir = path.join(getClawminiDir(), 'logs');
  const supervisor = new Supervisor(logDir);

  writeSupervisorPid(process.pid);
  process.on('exit', () => removeSupervisorPid());

  const onSignal = () => {
    void supervisor.shutdown(0);
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  if (enabled.includes('daemon')) {
    process.stderr.write('[supervisor] starting daemon...\n');
    await supervisor.startService('daemon');
    await supervisor.waitForDaemonSocket();
    process.stderr.write('[supervisor] daemon ready\n');
  }

  for (const name of enabled) {
    if (name === 'daemon') continue;
    await supervisor.startService(name);
  }

  process.stderr.write(`[supervisor] running: ${enabled.join(', ')}\n`);
  process.stderr.write("[supervisor] press Ctrl-C to stop (or run 'clawmini down' elsewhere)\n");
}

function isSocketLive(socketPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const client = net.createConnection({ path: socketPath });
    client.on('connect', () => {
      client.destroy();
      resolve(true);
    });
    client.on('error', () => resolve(false));
  });
}

function printSupervisorLogTail(supLog: string, fromOffset: number): void {
  if (!fs.existsSync(supLog)) return;
  const size = fs.statSync(supLog).size;
  if (size <= fromOffset) return;
  const fd = fs.openSync(supLog, 'r');
  try {
    const len = size - fromOffset;
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, fromOffset);
    const text = buf.toString('utf-8');
    process.stderr.write('--- supervisor.log ---\n');
    process.stderr.write(text);
    if (!text.endsWith('\n')) process.stderr.write('\n');
  } finally {
    fs.closeSync(fd);
  }
}

async function runDetached(args: string[]): Promise<never> {
  const clawDir = getClawminiDir();
  const logDir = path.join(clawDir, 'logs');
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  const supLog = path.join(logDir, 'supervisor.log');
  const supLogOffset = fs.existsSync(supLog) ? fs.statSync(supLog).size : 0;
  const outFd = fs.openSync(supLog, 'a');

  // Drop any stale pid file so we can detect the new child writing one.
  removeSupervisorPid();

  const childArgs = args.filter((a) => a !== '--detach' && a !== '-d');
  const child = spawn(process.execPath, childArgs, {
    detached: true,
    stdio: ['ignore', outFd, outFd],
    cwd: process.cwd(),
    env: process.env,
  });
  child.unref();
  fs.closeSync(outFd);

  const pidPath = getSupervisorPidPath();
  const socketPath = getSocketPath();
  const STARTUP_TIMEOUT_MS = 30_000;
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      console.error(
        `clawmini serve exited during startup (code=${child.exitCode}, signal=${child.signalCode}).`
      );
      printSupervisorLogTail(supLog, supLogOffset);
      process.exit(1);
    }
    if (fs.existsSync(pidPath) && fs.existsSync(socketPath)) {
      console.log(`Started clawmini supervisor in background (pid ${child.pid}).`);
      console.log(`  Logs:   clawmini logs -f`);
      console.log(`  Stop:   clawmini down`);
      process.exit(0);
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  console.error(`clawmini serve did not become ready within ${STARTUP_TIMEOUT_MS / 1000}s.`);
  printSupervisorLogTail(supLog, supLogOffset);
  process.exit(1);
}

export const serveCmd = new Command('serve')
  .description('Run daemon, web UI, and configured adapters under one supervisor')
  .option('-d, --detach', 'Run in the background; logs go to .clawmini/logs/')
  .option('--only <services>', 'Comma-separated subset to run (daemon,web,discord,google-chat)')
  .option('--exclude <services>', 'Comma-separated services to skip')
  .action(async (options: ServeOptions) => {
    const clawDir = getClawminiDir();
    if (!fs.existsSync(clawDir)) {
      console.error(`Not a clawmini workspace (no ${clawDir}). Run 'clawmini init' first.`);
      process.exit(1);
    }

    const existingSupervisorPid = readSupervisorPid();
    if (existingSupervisorPid) {
      console.error(
        `clawmini serve is already running (pid ${existingSupervisorPid}). Run 'clawmini down' to stop it.`
      );
      process.exit(1);
    }

    const socketPath = getSocketPath();
    if (fs.existsSync(socketPath)) {
      if (await isSocketLive(socketPath)) {
        console.error(
          "A clawmini daemon is already running (socket present). Run 'clawmini down' before 'clawmini serve'."
        );
        process.exit(1);
      }
      // Socket file is left over from a crashed/killed daemon — remove it
      // so we can bind cleanly.
      try {
        fs.unlinkSync(socketPath);
        process.stderr.write(`[supervisor] removed stale socket at ${socketPath}\n`);
      } catch (err) {
        console.error(
          `Failed to remove stale socket at ${socketPath}: ${err instanceof Error ? err.message : String(err)}`
        );
        process.exit(1);
      }
    }

    let enabled: ServiceName[];
    try {
      enabled = resolveEnabledServices({
        only: options.only,
        exclude: options.exclude,
        adapterConfigPresent: {
          'adapter-discord': fs.existsSync(getDiscordConfigPath()),
          'adapter-google-chat': fs.existsSync(getGoogleChatConfigPath()),
        },
      });
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }

    if (enabled.length === 0) {
      console.error('No services selected. Check --only/--exclude.');
      process.exit(1);
    }

    if (options.detach) {
      await runDetached(process.argv.slice(1));
      return;
    }

    try {
      await runPreStart();
    } catch (err) {
      console.error('Pre-start setup failed:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }

    try {
      await runForeground(enabled);
    } catch (err) {
      console.error('Failed to start services:', err instanceof Error ? err.message : String(err));
      removeSupervisorPid();
      process.exit(1);
    }
  });
