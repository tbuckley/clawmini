import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

export interface InstallInfo {
  /** True when the running clawmini binary lives under `npm root -g` after realpath. */
  isNpmGlobal: boolean;
  /** The realpath of the running entry point (process.argv[1] resolved). */
  entryRealPath: string;
  /** The realpath of `npm root -g`, when available. */
  npmRootRealPath: string | null;
}

function realpathOrNull(p: string): string | null {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

function getNpmRootGlobal(): string | null {
  try {
    const out = execFileSync('npm', ['root', '-g'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim() || null;
  } catch {
    return null;
  }
}

export function detectInstall(entryPath: string = process.argv[1] ?? ''): InstallInfo {
  const entryRealPath = realpathOrNull(entryPath) ?? entryPath;
  const npmRoot = getNpmRootGlobal();
  const npmRootRealPath = npmRoot ? (realpathOrNull(npmRoot) ?? npmRoot) : null;

  let isNpmGlobal = false;
  if (npmRootRealPath) {
    const rootWithSep = npmRootRealPath.endsWith(path.sep)
      ? npmRootRealPath
      : npmRootRealPath + path.sep;
    isNpmGlobal = entryRealPath === npmRootRealPath || entryRealPath.startsWith(rootWithSep);
  }

  return { isNpmGlobal, entryRealPath, npmRootRealPath };
}
