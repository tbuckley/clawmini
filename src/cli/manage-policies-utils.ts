import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { PolicyConfigFile, PolicyDefinition } from '../shared/policies.js';
import { parseShellArgs } from '../shared/utils/shell.js';
import { getClawminiDir } from '../shared/workspace.js';

const NAME_RE = /^[a-z0-9-]+$/;

export function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

export function assertValidName(name: string): void {
  if (!NAME_RE.test(name)) {
    fail('Policy name must only contain lowercase letters, numbers, and hyphens.');
  }
}

export function loadPolicies(): {
  dirPath: string;
  policies: PolicyConfigFile;
  policiesPath: string;
} {
  const dirPath = getClawminiDir();
  const policiesPath = path.join(dirPath, 'policies.json');
  if (!fs.existsSync(dirPath)) {
    fail('.clawmini directory not found. Please run "clawmini init" first.');
  }
  let policies: PolicyConfigFile = { policies: {} };
  if (fs.existsSync(policiesPath)) {
    policies = JSON.parse(fs.readFileSync(policiesPath, 'utf8'));
  }
  return { dirPath, policies, policiesPath };
}

export function writePolicies(policiesPath: string, policies: PolicyConfigFile): void {
  // policies.json gates every policy invocation; a partial write would brick
  // policy resolution. Stage to a sibling tempfile and rename — rename(2) on
  // the same filesystem is atomic, so readers see either the old or new file.
  const tmpPath = `${policiesPath}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(policies, null, 2));
    fs.renameSync(tmpPath, policiesPath);
  } catch (err) {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // tmpfile may not exist if writeFileSync threw before creating it.
    }
    throw err;
  }
}

export function installScript(dirPath: string, name: string, scriptFile: string): string {
  const scriptsDir = path.join(dirPath, 'policy-scripts');
  if (!fs.existsSync(scriptsDir)) {
    fs.mkdirSync(scriptsDir, { recursive: true });
  }
  const ext = path.extname(scriptFile) || '.sh';
  const destScript = path.join(scriptsDir, `${name}${ext}`);
  fs.copyFileSync(scriptFile, destScript);
  fs.chmodSync(destScript, 0o755);
  return `./.clawmini/policy-scripts/${path.basename(destScript)}`;
}

// Resolves a stored policy.command (relative to the workspace root) and
// returns its absolute path if it lives inside the managed `policy-scripts/`
// directory, else null. We compare absolute paths so basename collisions
// outside the dir cannot trigger an unintended unlink.
export function scriptInsidePolicyScripts(dirPath: string, command: string): string | null {
  const workspaceRoot = path.dirname(dirPath);
  const abs = path.resolve(workspaceRoot, command);
  const scriptsDir = path.join(dirPath, 'policy-scripts');
  const sep = path.sep;
  const dirWithSep = scriptsDir.endsWith(sep) ? scriptsDir : scriptsDir + sep;
  return abs.startsWith(dirWithSep) ? abs : null;
}

export function unlinkIfExists(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

export function applyCommandString(definition: PolicyDefinition, commandStr: string): void {
  let parts: string[];
  try {
    parts = parseShellArgs(commandStr);
  } catch (err) {
    fail(`--command: ${err instanceof Error ? err.message : String(err)}`);
  }
  const [head, ...rest] = parts;
  if (head === undefined) {
    fail('--command must contain a command to run.');
  }
  definition.command = head;
  if (rest.length > 0) {
    definition.args = rest;
  }
}
