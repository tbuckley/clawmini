import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Command } from 'commander';
import {
  readSettings,
  writeSettings,
  enableEnvironment,
  readEnvironment,
  getWorkspaceRoot,
} from '../../shared/workspace.js';
import { wrapCommandForEnvironment } from '../../shared/env-exec.js';
import { handleError } from '../utils.js';

export const environmentsCmd = new Command('environments').description('Manage environments');

environmentsCmd
  .command('enable <name>')
  .description('Enable an environment for a path in the workspace')
  .option('-p, --path <subpath>', 'Path to apply the environment to', './')
  .action(async (name: string, options: { path: string }) => {
    try {
      await enableEnvironment(name, options.path);
    } catch (err) {
      handleError('enable environment', err);
    }
  });

environmentsCmd
  .command('disable')
  .description('Disable an environment mapping')
  .option('-p, --path <subpath>', 'Path to remove the environment from', './')
  .action(async (options: { path: string }) => {
    try {
      const settings = await readSettings();
      if (!settings?.environments || !settings.environments[options.path]) {
        console.log(`No environment mapping found for path '${options.path}'.`);
        return;
      }

      const name = settings.environments[options.path];
      delete settings.environments[options.path];
      await writeSettings(settings);

      console.log(`Disabled environment '${name}' for path '${options.path}'.`);
    } catch (err) {
      handleError('disable environment', err);
    }
  });

environmentsCmd
  .command('check <name>')
  .description(
    'Run the standard suite of sandbox checks against the named environment and report PASS/FAIL'
  )
  .action(async (name: string) => {
    try {
      const passed = await runEnvironmentChecks(name);
      if (!passed) process.exit(1);
    } catch (err) {
      handleError('check environment', err);
    }
  });

interface SandboxRunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface CheckContext {
  envName: string;
  workspaceRoot: string;
  runInSandbox: (command: string) => Promise<SandboxRunResult>;
}

interface CheckResult {
  name: string;
  passed: boolean;
  details?: string;
}

type Check = (ctx: CheckContext) => Promise<CheckResult>;

// The same suite runs against every environment. Envs differ in what they
// restrict (filesystem, network, both, neither), so the FAILs are the
// informative signal — e.g. the `macos` env passes the filesystem checks
// but fails the network ones.
const CHECKS: Check[] = [
  checkWorkspaceWritable,
  checkClawminiHidden,
  checkHttpProxyEnv,
  checkClawminiLiteOnPath,
  checkNonAllowlistedDomainBlocked,
  checkHostFilesystemEscape,
];

async function runEnvironmentChecks(name: string): Promise<boolean> {
  const envConfig = await readEnvironment(name);
  if (!envConfig) {
    console.error(`Environment '${name}' not found.`);
    process.exit(1);
  }

  const workspaceRoot = getWorkspaceRoot();
  const ctx: CheckContext = {
    envName: name,
    workspaceRoot,
    runInSandbox: async (command: string) => {
      const { command: wrapped, env } = await wrapCommandForEnvironment(name, command, {
        workspaceDir: workspaceRoot,
        agentDir: workspaceRoot,
      });
      const result = spawnSync(wrapped, {
        shell: true,
        cwd: workspaceRoot,
        env: { ...process.env, ...env },
        encoding: 'utf8',
      });
      return {
        status: result.status,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
      };
    },
  };

  console.log(`Checking environment '${name}':`);

  let passedCount = 0;
  let failedCount = 0;
  for (const check of CHECKS) {
    const result = await check(ctx);
    if (result.passed) {
      passedCount += 1;
      console.log(`  [PASS] ${result.name}`);
    } else {
      failedCount += 1;
      console.log(`  [FAIL] ${result.name}`);
      if (result.details) {
        for (const line of result.details.split('\n')) {
          console.log(`         ${line}`);
        }
      }
    }
  }

  const total = passedCount + failedCount;
  console.log('');
  console.log(`${passedCount} passed, ${failedCount} failed (${total} total)`);
  return failedCount === 0;
}

function describeFailure(result: SandboxRunResult): string {
  const parts: string[] = [];
  if (result.stderr.trim()) parts.push(`stderr: ${result.stderr.trim()}`);
  if (result.stdout.trim()) parts.push(`stdout: ${result.stdout.trim()}`);
  if (result.status !== null) parts.push(`exit: ${result.status}`);
  return parts.join('\n');
}

async function checkWorkspaceWritable(ctx: CheckContext): Promise<CheckResult> {
  const name = 'workspace is writable';
  const r = await ctx.runInSandbox(
    'touch clawmini-check-writable.tmp && rm clawmini-check-writable.tmp'
  );
  if (r.status === 0) return { name, passed: true };
  return { name, passed: false, details: describeFailure(r) };
}

async function checkClawminiHidden(ctx: CheckContext): Promise<CheckResult> {
  const name = '.clawmini directory is hidden from the sandbox';
  const r = await ctx.runInSandbox('ls -A .clawmini 2>/dev/null');
  const visibleEntries = r.stdout.trim();
  if (visibleEntries === '') return { name, passed: true };
  return { name, passed: false, details: `saw entries: ${visibleEntries}` };
}

async function checkHttpProxyEnv(ctx: CheckContext): Promise<CheckResult> {
  const expected = 'http://127.0.0.1:8888';
  const name = `HTTP_PROXY env var is set to ${expected}`;
  const r = await ctx.runInSandbox('printf %s "${HTTP_PROXY:-}"');
  const actual = r.stdout.trim();
  if (actual === expected) return { name, passed: true };
  return { name, passed: false, details: `saw HTTP_PROXY=${JSON.stringify(actual)}` };
}

async function checkClawminiLiteOnPath(ctx: CheckContext): Promise<CheckResult> {
  const name = 'clawmini-lite.js is on PATH';
  const r = await ctx.runInSandbox('command -v clawmini-lite.js');
  if (r.status === 0 && r.stdout.trim() !== '') return { name, passed: true };
  return { name, passed: false, details: describeFailure(r) };
}

async function checkNonAllowlistedDomainBlocked(ctx: CheckContext): Promise<CheckResult> {
  const name = 'non-allowlisted domain is blocked by the proxy (expects HTTP 403)';
  const r = await ctx.runInSandbox(
    'curl -s -o /dev/null -w %{http_code} --max-time 5 http://example.com'
  );
  const code = r.stdout.trim();
  if (code === '403') return { name, passed: true };
  return { name, passed: false, details: `got HTTP ${code || '<no response>'}` };
}

async function checkHostFilesystemEscape(ctx: CheckContext): Promise<CheckResult> {
  const name = 'writes outside approved paths do not escape to the host';
  const home = process.env.HOME;
  if (!home) {
    return { name, passed: false, details: 'HOME env var not set on host' };
  }
  const filename = `clawmini-check-escape-${Date.now()}-${process.pid}.tmp`;
  const hostPath = path.join(home, filename);
  try {
    fs.rmSync(hostPath, { force: true });
  } catch {
    /* ignore */
  }
  // Write from inside the sandbox; ignore whether the write itself succeeds —
  // the check is whether the file lands on the host.
  await ctx.runInSandbox(`touch "$HOME/${filename}" 2>/dev/null || true`);
  const escaped = fs.existsSync(hostPath);
  if (escaped) {
    try {
      fs.rmSync(hostPath, { force: true });
    } catch {
      /* best-effort cleanup */
    }
    return { name, passed: false, details: `wrote host file at ${hostPath}` };
  }
  return { name, passed: true };
}
