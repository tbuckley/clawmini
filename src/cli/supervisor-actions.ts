import { spawn } from 'node:child_process';

import { detectInstall } from './install-detection.js';
import { startControlServer, type ControlResponse } from './supervisor-control.js';
import { removeSupervisorPid } from './supervisor-pid.js';
import type { Supervisor } from './supervisor.js';

/**
 * Run an in-place upgrade: stop all children, run `npm install -g
 * clawmini@latest`, then relaunch a detached `clawmini serve`. The current
 * supervisor process exits at the end so the freshly installed binary
 * supersedes it.
 */
export async function runUpgrade(supervisor: Supervisor): Promise<void> {
  const info = detectInstall();
  if (!info.isNpmGlobal) {
    process.stderr.write(
      `[supervisor] /upgrade aborted: clawmini is not installed via npm install -g (running from ${info.entryRealPath}).\n`
    );
    return;
  }

  process.stderr.write('[supervisor] /upgrade: stopping all services...\n');
  await supervisor.stopAllChildren();

  process.stderr.write('[supervisor] /upgrade: running npm install -g clawmini@latest...\n');
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn('npm', ['install', '-g', 'clawmini@latest'], {
        stdio: 'inherit',
        env: process.env,
      });
      child.on('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`npm install -g exited with code ${code}`));
      });
      child.on('error', reject);
    });
  } catch (err) {
    process.stderr.write(
      `[supervisor] /upgrade failed: ${err instanceof Error ? err.message : String(err)}\n`
    );
    process.exit(1);
  }

  process.stderr.write('[supervisor] /upgrade: relaunching clawmini serve --detach...\n');
  // Drop our pid file so the new supervisor doesn't see us as already
  // running; it will write its own pid.
  removeSupervisorPid();
  const replacement = spawn('clawmini', ['serve', '--detach'], {
    detached: true,
    stdio: 'ignore',
    cwd: process.cwd(),
    env: process.env,
  });
  replacement.unref();
  process.exit(0);
}

// Grace period before the supervisor performs a destructive action. The
// daemon-side router fires sendControlRequest synchronously while it's still
// inside the message-handling pipeline (logging the user message + reply,
// tearing down the agent session). Without a delay, SIGTERM can arrive
// mid-write, dropping the chat log entries that confirm what happened.
const ACTION_GRACE_MS = 1000;

/**
 * Wire up the supervisor control socket so the daemon can request
 * /restart, /shutdown, and /upgrade out-of-band.
 */
export function startSupervisorControl(supervisor: Supervisor): void {
  startControlServer({
    restart: async (): Promise<ControlResponse> => {
      setTimeout(() => {
        void supervisor.restartService('daemon').catch((err) => {
          process.stderr.write(
            `[supervisor] /restart failed: ${err instanceof Error ? err.message : String(err)}\n`
          );
        });
      }, ACTION_GRACE_MS);
      return { ok: true };
    },
    shutdown: async (): Promise<ControlResponse> => {
      setTimeout(() => void supervisor.shutdown(0), ACTION_GRACE_MS);
      return { ok: true };
    },
    upgrade: async (): Promise<ControlResponse> => {
      const info = detectInstall();
      if (!info.isNpmGlobal) {
        return {
          ok: false,
          error: `not installed via npm install -g (running from ${info.entryRealPath})`,
        };
      }
      setTimeout(() => void runUpgrade(supervisor), ACTION_GRACE_MS);
      return { ok: true };
    },
  });
}
