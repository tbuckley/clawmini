import fs from 'node:fs/promises';
import fsSync, { constants } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { pathIsInsideDir } from '../shared/utils/fs.js';
import type { PolicyRequest, PolicyDefinition } from '../shared/policies.js';
import { resolveAgentDir } from './api/router-utils.js';
import {
  getWorkspaceRoot,
  getActiveEnvironmentInfo,
  readEnvironment,
} from '../shared/workspace.js';

export const MAX_SNAPSHOT_SIZE = 5 * 1024 * 1024;
export const MAX_INLINE_OUTPUT_LENGTH = 500;

/**
 * Translates a sandbox-relative cwd into an absolute host path scoped to agentDir.
 *
 * Security note (TOCTOU): There is an inherent race between validating the
 * resolved path here and the moment `spawn` uses it as cwd. A symlink created
 * on the host filesystem in that window could redirect execution outside
 * agentDir. We accept this because the sandboxed agent cannot modify the host
 * filesystem — only a local user or process with host-level access could
 * exploit the gap, and that is outside our threat model.
 */
export function translateSandboxPath(
  sandboxCwd: string,
  baseDir: string | undefined,
  agentDir: string
): string {
  let relativePath = sandboxCwd;

  let realSandboxCwd = sandboxCwd;
  let realAgentDir = agentDir;
  try {
    realSandboxCwd = fsSync.realpathSync(sandboxCwd);
  } catch (err: unknown) {
    if (
      !(err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT')
    ) {
      throw err;
    }
  }
  try {
    realAgentDir = fsSync.realpathSync(agentDir);
  } catch (err: unknown) {
    if (
      !(err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT')
    ) {
      throw err;
    }
  }

  if (baseDir && sandboxCwd.startsWith(baseDir)) {
    relativePath = sandboxCwd.slice(baseDir.length);
  } else if (
    !baseDir &&
    path.isAbsolute(realSandboxCwd) &&
    pathIsInsideDir(realSandboxCwd, realAgentDir, { allowSameDir: true })
  ) {
    return realSandboxCwd;
  }

  // Remove leading slash to make it correctly relative when resolving against agentDir
  if (relativePath.startsWith('/') || relativePath.startsWith('\\')) {
    relativePath = relativePath.slice(1);
  }

  const resolvedPath = path.resolve(agentDir, relativePath);

  // Security validation to prevent path traversal
  if (!pathIsInsideDir(resolvedPath, agentDir, { allowSameDir: true })) {
    throw new Error(
      `Security Error: Path resolves outside the allowed agent directory: ${resolvedPath}`
    );
  }

  return resolvedPath;
}

export async function resolveRequestCwd(
  requestCwd: string | undefined,
  agentId: string | undefined,
  workspaceRoot: string
): Promise<string> {
  const agentDir = await resolveAgentDir(agentId, workspaceRoot);
  const envInfo = await getActiveEnvironmentInfo(agentDir, workspaceRoot);
  let baseDir: string | undefined;
  if (envInfo) {
    const envConfig = await readEnvironment(envInfo.name, workspaceRoot);
    baseDir = envConfig?.baseDir;
  }
  return requestCwd ? translateSandboxPath(requestCwd, baseDir, agentDir) : workspaceRoot;
}

export async function createSnapshot(
  requestedPath: string,
  agentDir: string,
  snapshotDir: string
): Promise<string> {
  let realAgentDir: string;
  try {
    realAgentDir = await fs.realpath(agentDir);
  } catch (err) {
    throw new Error(`Agent directory not found or cannot be resolved: ${agentDir}`, { cause: err });
  }

  const resolvedRequestedPath = path.resolve(realAgentDir, requestedPath);

  // Verify it is inside the allowed agent directory
  if (!pathIsInsideDir(resolvedRequestedPath, realAgentDir, { allowSameDir: true })) {
    throw new Error(
      `Security Error: Path resolves outside the allowed agent directory: ${resolvedRequestedPath}`
    );
  }

  // Lstat prevents TOCTOU attacks by not following symlinks
  let stat;
  try {
    stat = await fs.lstat(resolvedRequestedPath);
  } catch (err) {
    throw new Error(`File not found or cannot be accessed: ${requestedPath}`, { cause: err });
  }

  if (stat.isSymbolicLink()) {
    throw new Error(`Security Error: Symlinks are not allowed: ${requestedPath}`);
  }

  if (!stat.isFile()) {
    throw new Error(`Requested path is not a file: ${requestedPath}`);
  }
  if (stat.size > MAX_SNAPSHOT_SIZE) {
    throw new Error(`File exceeds maximum snapshot size of 5MB: ${requestedPath}`);
  }

  // Generate unique filename for the snapshot
  const ext = path.extname(resolvedRequestedPath);
  const base = path.basename(resolvedRequestedPath, ext);

  await fs.mkdir(snapshotDir, { recursive: true });

  let snapshotPath: string;
  while (true) {
    const uniqueId = randomBytes(8).toString('hex');
    const snapshotFileName = `${base}_${uniqueId}${ext}`;
    snapshotPath = path.join(snapshotDir, snapshotFileName);

    try {
      await fs.copyFile(resolvedRequestedPath, snapshotPath, constants.COPYFILE_EXCL);
      break;
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        'code' in err &&
        (err as Error & { code?: string }).code === 'EEXIST'
      ) {
        continue;
      }
      throw err;
    }
  }

  return snapshotPath;
}

export function interpolateArgs(args: string[], snapshots: Record<string, string>): string[] {
  return args.map((arg) => {
    let interpolated = arg;
    for (const [key, snapshotPath] of Object.entries(snapshots)) {
      const variable = `{{${key}}}`;
      interpolated = interpolated.replaceAll(variable, snapshotPath);
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

export async function executeRequest(
  request: PolicyRequest,
  policy: PolicyDefinition,
  cwd?: string
): Promise<{ stdout: string; stderr: string; exitCode: number; commandStr: string }> {
  const fullArgs = [...(policy.args || []), ...request.args];
  const interpolatedArgs = interpolateArgs(fullArgs, request.fileMappings);

  const result = await executeSafe(policy.command, interpolatedArgs, cwd ? { cwd } : undefined);
  let stdout = result.stdout;
  let stderr = result.stderr;
  const exitCode = result.exitCode;

  const agentDir = await resolveAgentDir(request.agentId, getWorkspaceRoot());
  const tmpDir = path.join(agentDir, 'tmp');

  if (stdout.length >= MAX_INLINE_OUTPUT_LENGTH) {
    await fs.mkdir(tmpDir, { recursive: true });
    const stdoutPath = path.join(tmpDir, `stdout-${request.id}.txt`);
    await fs.writeFile(stdoutPath, stdout, 'utf-8');
    stdout = `stdout is ${stdout.length} characters, saved to ./tmp/stdout-${request.id}.txt\n`;
  }

  if (stderr.length >= MAX_INLINE_OUTPUT_LENGTH) {
    await fs.mkdir(tmpDir, { recursive: true });
    const stderrPath = path.join(tmpDir, `stderr-${request.id}.txt`);
    await fs.writeFile(stderrPath, stderr, 'utf-8');
    stderr = `stderr is ${stderr.length} characters, saved to ./tmp/stderr-${request.id}.txt\n`;
  }

  const commandStr = `${policy.command} ${interpolatedArgs.join(' ')}`;
  return { stdout, stderr, exitCode, commandStr };
}

export async function generateRequestPreview(request: PolicyRequest): Promise<string> {
  let previewContent = `Sandbox Policy Request: ${request.commandName}\n`;
  previewContent += `ID: ${request.id}\n`;
  if (request.args.length > 0) {
    previewContent += `Args: ${request.args.join(' ')}\n`;
  }

  for (const [name, snapPath] of Object.entries(request.fileMappings)) {
    previewContent += `File [${name}]:\n`;
    try {
      let content = await fs.readFile(snapPath, 'utf8');
      if (content.length > 500) {
        content = content.substring(0, 500) + '\n... (truncated)\n';
      }
      previewContent += content;
    } catch (e: unknown) {
      previewContent += `<Error reading file: ${(e as Error).message}>\n`;
    }
  }

  previewContent += `\nUse /approve ${request.id} or /reject ${request.id} [reason]`;
  return previewContent;
}
