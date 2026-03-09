import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { pathIsInsideDir } from '../shared/utils/fs.js';

export async function createSnapshot(
  requestedPath: string,
  workspaceRoot: string,
  snapshotDir: string
): Promise<string> {
  const absoluteRequestedPath = path.resolve(workspaceRoot, requestedPath);

  // Realpath prevents symlink attacks (TOCTOU) by resolving actual location
  let realPath: string;
  let realWorkspaceRoot: string;
  try {
    realPath = await fs.realpath(absoluteRequestedPath);
    realWorkspaceRoot = await fs.realpath(workspaceRoot);
  } catch (err) {
    throw new Error(`File not found or cannot be resolved: ${requestedPath}`, { cause: err });
  }

  // Verify it is inside the allowed workspace
  if (!pathIsInsideDir(realPath, realWorkspaceRoot, { allowSameDir: true })) {
    throw new Error(`Security Error: Path resolves outside the allowed workspace: ${realPath}`);
  }

  const stat = await fs.stat(realPath);
  if (!stat.isFile()) {
    throw new Error(`Requested path is not a file: ${realPath}`);
  }
  if (stat.size > 5 * 1024 * 1024) {
    // 5MB limit
    throw new Error(`File exceeds maximum snapshot size of 5MB: ${realPath}`);
  }

  // Generate unique filename for the snapshot
  const ext = path.extname(realPath);
  const base = path.basename(realPath, ext);
  const uniqueId = randomBytes(8).toString('hex');
  const snapshotFileName = `${base}_${uniqueId}${ext}`;
  const snapshotPath = path.join(snapshotDir, snapshotFileName);

  // Copy to secure temporary directory
  await fs.mkdir(snapshotDir, { recursive: true });
  await fs.copyFile(realPath, snapshotPath);

  return snapshotPath;
}

export function interpolateArgs(args: string[], snapshots: Record<string, string>): string[] {
  return args.map((arg) => {
    let interpolated = arg;
    for (const [key, snapshotPath] of Object.entries(snapshots)) {
      const variable = `{{${key}}}`;
      interpolated = interpolated.split(variable).join(snapshotPath);
    }
    return interpolated;
  });
}

export function executeSafe(
  command: string,
  args: string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    // Safe execution: shell is strictly false to prevent command injection
    const p = spawn(command, args, {
      shell: false,
      cwd: options?.cwd,
      env: options?.env,
    });

    let stdout = '';
    let stderr = '';

    if (p.stdout) {
      p.stdout.on('data', (data) => {
        stdout += data.toString();
      });
    }

    if (p.stderr) {
      p.stderr.on('data', (data) => {
        stderr += data.toString();
      });
    }

    p.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });

    p.on('error', (err) => {
      resolve({ stdout: '', stderr: err.toString(), exitCode: 1 });
    });
  });
}
