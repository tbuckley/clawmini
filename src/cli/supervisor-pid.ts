import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { getClawminiDir } from '../shared/workspace.js';

export function getSupervisorPidPath(startDir = process.cwd()): string {
  return path.join(getClawminiDir(startDir), 'supervisor.pid');
}

// Returns the kernel-reported start time of `pid` as an opaque string, or
// null if the process doesn't exist. The exact format is platform-defined
// but stable per-host, which is all we need: we only ever compare the
// stored value against a fresh read on the same machine.
function getProcessStartTime(pid: number): string | null {
  try {
    const out = execFileSync('ps', ['-p', String(pid), '-o', 'lstart='], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const trimmed = out.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

// The pid file stores `<pid>:<start-time>` so we can detect pid reuse:
// `kill(pid, 0)` only confirms *something* with that pid is alive. After
// the supervisor exits the OS may hand the same pid to an unrelated
// process (browser tab, ssh, etc.) — without the start-time check we'd
// happily SIGTERM that.
export function readSupervisorPid(startDir = process.cwd()): number | null {
  const p = getSupervisorPidPath(startDir);
  if (!fs.existsSync(p)) return null;
  const content = fs.readFileSync(p, 'utf-8').trim();
  const sep = content.indexOf(':');
  if (sep <= 0) return null;
  const pid = parseInt(content.slice(0, sep), 10);
  const storedStart = content.slice(sep + 1).trim();
  if (!Number.isFinite(pid) || pid <= 0 || storedStart.length === 0) return null;
  try {
    process.kill(pid, 0);
  } catch {
    return null;
  }
  const currentStart = getProcessStartTime(pid);
  if (currentStart === null || currentStart !== storedStart) return null;
  return pid;
}

export function writeSupervisorPid(pid: number, startDir = process.cwd()): void {
  const startTime = getProcessStartTime(pid);
  if (!startTime) {
    throw new Error(`Cannot read start time for pid ${pid}; refusing to write supervisor.pid`);
  }
  fs.writeFileSync(getSupervisorPidPath(startDir), `${pid}:${startTime}`);
}

export function removeSupervisorPid(startDir = process.cwd()): void {
  const p = getSupervisorPidPath(startDir);
  if (fs.existsSync(p)) {
    try {
      fs.unlinkSync(p);
    } catch {
      // best-effort cleanup
    }
  }
}
