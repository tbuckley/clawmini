import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { resolveCompiledScript } from '../shared/lite.js';
import { getClawminiDir } from '../shared/workspace.js';
import { BUILTIN_POLICIES } from '../shared/policies.js';

const HASHBANG = '#!/usr/bin/env node\n';

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export async function installBuiltinPolicies(dirPath = getClawminiDir()): Promise<void> {
  const policyScriptsDir = path.join(dirPath, 'policy-scripts');
  await fs.mkdir(policyScriptsDir, { recursive: true });

  for (const name of Object.keys(BUILTIN_POLICIES)) {
    try {
      const sourcePath = await resolveCompiledScript(name, import.meta.url);
      let scriptContent = await fs.readFile(sourcePath, 'utf8');
      if (!scriptContent.startsWith('#!')) {
        scriptContent = HASHBANG + scriptContent;
      }

      const destPath = path.join(policyScriptsDir, `${name}.js`);
      let existing: string | null = null;
      try {
        existing = await fs.readFile(destPath, 'utf8');
      } catch {
        // missing — write below
      }
      if (existing !== null && sha256(existing) === sha256(scriptContent)) {
        continue;
      }
      await fs.writeFile(destPath, scriptContent, { mode: 0o755 });
    } catch (err) {
      console.warn(
        `Warning: Could not install built-in policy ${name}:`,
        err instanceof Error ? err.message : String(err)
      );
    }
  }
}
