import fs from 'node:fs';
import path from 'node:path';
import { getClawminiDir } from '../shared/workspace.js';

export function getSupervisorPidPath(startDir = process.cwd()): string {
  return path.join(getClawminiDir(startDir), 'supervisor.pid');
}

export function readSupervisorPid(startDir = process.cwd()): number | null {
  const p = getSupervisorPidPath(startDir);
  if (!fs.existsSync(p)) return null;
  const content = fs.readFileSync(p, 'utf-8').trim();
  const pid = parseInt(content, 10);
  if (!Number.isFinite(pid) || pid <= 0) return null;
  try {
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}

export function writeSupervisorPid(pid: number, startDir = process.cwd()): void {
  fs.writeFileSync(getSupervisorPidPath(startDir), String(pid));
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
