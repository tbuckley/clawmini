import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { detectInstall } from './install-detection.js';
import {
  startControlServer,
  type ControlRequest,
  type ControlResponse,
} from './supervisor-control.js';
import { removeSupervisorPid } from './supervisor-pid.js';
import { enqueuePendingReply, dequeuePendingReply } from '../daemon/pending-replies.js';
import type { Supervisor } from './supervisor.js';

// Grace period before a destructive action fires. The daemon-side router
// awaits sendControlRequest but the daemon still needs to flush the user
// message + ack reply through the chat log before the daemon process is
// killed. SIGTERM arriving mid-flush is non-fatal (the daemon's own SIGTERM
// handler still runs) but the grace makes the ordering deterministic.
const ACTION_GRACE_MS = 1000;

/**
 * Wire up the supervisor control socket so the daemon can request
 * /restart, /shutdown, and /upgrade out-of-band.
 */
export function startSupervisorControl(supervisor: Supervisor): void {
  startControlServer({
    restart: async (req: ControlRequest): Promise<ControlResponse> => {
      // Enqueue BEFORE scheduling the kill, so a crash between enqueue and
      // kill leaves the post-restart message ready to drain.
      if (req.chatId) {
        enqueuePendingReply({
          chatId: req.chatId,
          kind: 'restart-complete',
          ...(req.messageId ? { messageId: req.messageId } : {}),
        });
      }
      setTimeout(() => {
        void supervisor.restartService('daemon').catch((err) => {
          process.stderr.write(
            `[supervisor] /restart failed: ${err instanceof Error ? err.message : String(err)}\n`
          );
          // Restart failed — back out the queued reply so the next successful
          // start doesn't surface a phantom "restarted" message.
          if (req.chatId && req.messageId) {
            dequeuePendingReply(
              (e) => e.kind === 'restart-complete' && e.messageId === req.messageId
            );
          }
        });
      }, ACTION_GRACE_MS);
      return { ok: true };
    },
    shutdown: async (): Promise<ControlResponse> => {
      setTimeout(() => void supervisor.shutdown(0), ACTION_GRACE_MS);
      return { ok: true };
    },
    upgrade: async (req: ControlRequest): Promise<ControlResponse> => {
      const info = detectInstall();
      if (!info.isNpmGlobal) {
        return {
          ok: false,
          error: `not installed via npm install -g (running from ${info.entryRealPath})`,
        };
      }
      const version = req.version?.trim();
      if (!version) {
        return { ok: false, error: 'missing target version' };
      }
      if (!isAcceptableVersion(version)) {
        return { ok: false, error: `invalid version: ${version}` };
      }
      setTimeout(() => {
        void runUpgrade(supervisor, version, req.chatId, req.messageId).catch((err) => {
          process.stderr.write(
            `[supervisor] /upgrade encountered an unexpected error: ${err instanceof Error ? err.message : String(err)}\n`
          );
        });
      }, ACTION_GRACE_MS);
      return { ok: true };
    },
  });
}

// Accept semver-ish versions (1.2.3, 1.2.3-beta.1, etc.), the literal
// "latest", or a dist-tag (alphanumeric + dashes). Reject anything else so a
// malicious client can't smuggle shell metacharacters or `--registry=...`
// into the npm command line.
export function isAcceptableVersion(version: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,63}$/.test(version);
}

/**
 * In-place upgrade. Order:
 *   1. `npm install -g clawmini@<version>` (services kept running so the
 *      user isn't left in the dark if the install fails).
 *   2. Resolve the freshly-installed binary by absolute path. Bail out with
 *      an upgrade-failed reply if it's missing.
 *   3. Enqueue the upgrade-complete reply.
 *   4. Stop all children, spawn the replacement supervisor, exit.
 *
 * Any failure path enqueues an upgrade-failed reply (so the user gets visible
 * feedback) and restarts the daemon to drain it, rather than silently exiting.
 */
export async function runUpgrade(
  supervisor: Supervisor,
  version: string,
  chatId?: string,
  messageId?: string
): Promise<void> {
  const info = detectInstall();
  if (!info.isNpmGlobal || !info.npmRootRealPath) {
    process.stderr.write(
      `[supervisor] /upgrade aborted: clawmini is not installed via npm install -g (running from ${info.entryRealPath}).\n`
    );
    return;
  }

  const installErr = await runNpmInstall(version);
  if (installErr) {
    process.stderr.write(`[supervisor] /upgrade failed: ${installErr}\n`);
    if (chatId) {
      enqueuePendingReply({
        chatId,
        kind: 'upgrade-failed',
        ...(messageId ? { messageId } : {}),
        requestedVersion: version,
        reason: installErr,
      });
      // The daemon is still running (we never stopped it). Restart it so it
      // drains the upgrade-failed message into the chat.
      await supervisor.restartService('daemon').catch((err) => {
        process.stderr.write(
          `[supervisor] additionally failed to restart daemon to surface the failure: ${err instanceof Error ? err.message : String(err)}\n`
        );
      });
    }
    return;
  }

  // npm install reported success — confirm the binary exists where we expect
  // before we start tearing down services.
  const newCli = path.join(info.npmRootRealPath, 'clawmini', 'dist', 'cli', 'index.mjs');
  if (!fs.existsSync(newCli)) {
    const reason = `npm install reported success but ${newCli} is missing`;
    process.stderr.write(`[supervisor] /upgrade aborted: ${reason}\n`);
    if (chatId) {
      enqueuePendingReply({
        chatId,
        kind: 'upgrade-failed',
        ...(messageId ? { messageId } : {}),
        requestedVersion: version,
        reason,
      });
      await supervisor.restartService('daemon').catch(() => {});
    }
    return;
  }

  if (chatId) {
    enqueuePendingReply({
      chatId,
      kind: 'upgrade-complete',
      ...(messageId ? { messageId } : {}),
      requestedVersion: version,
    });
  }

  process.stderr.write('[supervisor] /upgrade: stopping all services...\n');
  await supervisor.stopAllChildren();

  process.stderr.write(`[supervisor] /upgrade: relaunching ${newCli} serve --detach...\n`);
  // Drop our pid file so the new supervisor doesn't see us as already
  // running; it will write its own pid on startup.
  removeSupervisorPid();

  // Run the new entry point directly via the current Node binary so the
  // spawn doesn't depend on the shell's PATH being refreshed (which it isn't
  // for an already-running process).
  const replacement = spawn(process.execPath, [newCli, 'serve', '--detach'], {
    detached: true,
    stdio: 'ignore',
    cwd: process.cwd(),
    env: process.env,
  });

  const spawnOk = await waitForSpawn(replacement);
  if (!spawnOk) {
    process.stderr.write(
      `[supervisor] /upgrade: replacement supervisor failed to spawn — restarting in place\n`
    );
    if (chatId) {
      // Roll back the optimistic complete reply and replace it with a
      // failure entry so the user knows the upgrade landed on disk but
      // never came back up.
      dequeuePendingReply(
        (e) =>
          e.kind === 'upgrade-complete' &&
          e.messageId === messageId &&
          e.requestedVersion === version
      );
      enqueuePendingReply({
        chatId,
        kind: 'upgrade-failed',
        ...(messageId ? { messageId } : {}),
        requestedVersion: version,
        reason: 'replacement supervisor failed to spawn',
      });
    }
    // Bring the daemon back so the failure message gets drained and the user
    // isn't left without a running clawmini.
    try {
      await supervisor.startService('daemon');
      await supervisor.waitForDaemonSocket();
    } catch (err) {
      process.stderr.write(
        `[supervisor] additionally failed to restart daemon after spawn failure: ${err instanceof Error ? err.message : String(err)}\n`
      );
    }
    return;
  }

  replacement.unref();
  process.exit(0);
}

function runNpmInstall(version: string): Promise<string | null> {
  return new Promise((resolve) => {
    // execFile-style argv (no shell), so the version argument can't be
    // interpreted by a shell even if it slipped past isAcceptableVersion.
    const child = spawn('npm', ['install', '-g', `clawmini@${version}`], {
      stdio: 'inherit',
      env: process.env,
    });
    child.on('exit', (code) => {
      if (code === 0) resolve(null);
      else resolve(`npm install -g exited with code ${code}`);
    });
    child.on('error', (err) => {
      resolve(err instanceof Error ? err.message : String(err));
    });
  });
}

function waitForSpawn(child: ReturnType<typeof spawn>, timeoutMs = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    child.once('spawn', () => settle(true));
    child.once('error', (err) => {
      process.stderr.write(`[supervisor] replacement spawn error: ${err.message}\n`);
      settle(false);
    });
    // 'spawn' fires almost immediately on success. Cap the wait so we never
    // hang if neither event fires.
    setTimeout(() => settle(true), timeoutMs);
  });
}
