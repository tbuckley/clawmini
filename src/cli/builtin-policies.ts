import fs from 'node:fs';
import path from 'node:path';
import { resolveCompiledScript } from '../shared/lite.js';
import { getClawminiDir } from '../shared/workspace.js';

export async function installBuiltinPolicies(dirPath = getClawminiDir()) {
  const policyScriptsDir = path.join(dirPath, 'policy-scripts');
  if (!fs.existsSync(policyScriptsDir)) {
    fs.mkdirSync(policyScriptsDir, { recursive: true });
  }

  const builtins = ['propose-policy'];

  for (const name of builtins) {
    try {
      const foundPath = await resolveCompiledScript(name, import.meta.url);
      let scriptContent = fs.readFileSync(foundPath, 'utf8');

      if (!scriptContent.startsWith('#!')) {
        scriptContent = '#!/usr/bin/env node\n' + scriptContent;
      }

      const destPath = path.join(policyScriptsDir, `${name}.js`);
      fs.writeFileSync(destPath, scriptContent, { mode: 0o755 });
    } catch (err) {
      console.warn(`Warning: Could not install built-in policy ${name}:`, err instanceof Error ? err.message : String(err));
    }
  }
}
