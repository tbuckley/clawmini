import { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import { handleError } from '../utils.js';
import { resolveCompiledScript } from '../../shared/lite.js';
import type { PolicyConfig } from '../../shared/policies.js';
import { getClawminiDir } from '../../shared/workspace.js';

const SUPPORTED_POLICIES = ['propose-policy'];

export const policiesCmd = new Command('policies').description('Manage sandbox policies');

policiesCmd
  .command('add <name>')
  .description('Add a new policy')
  .action(async (name: string) => {
    if (!SUPPORTED_POLICIES.includes(name)) {
      handleError(
        'add policy',
        new Error(
          `Unsupported policy: "${name}". Supported policies: ${SUPPORTED_POLICIES.join(', ')}`
        )
      );
    }

    const dirPath = getClawminiDir();
    const policyScriptsDir = path.join(dirPath, 'policy-scripts');
    const policiesPath = path.join(dirPath, 'policies.json');

    if (!fs.existsSync(dirPath)) {
      handleError(
        'add policy',
        new Error('.clawmini directory not found. Please run "clawmini init" first.')
      );
    }

    if (!fs.existsSync(policyScriptsDir)) {
      fs.mkdirSync(policyScriptsDir, { recursive: true });
    }

    // Update or create policies.json
    let policies: PolicyConfig = { policies: {} };
    if (fs.existsSync(policiesPath)) {
      policies = JSON.parse(fs.readFileSync(policiesPath, 'utf8'));
    }

    policies.policies[name] = {
      description: 'Propose a new policy to create',
      command: `./.clawmini/policy-scripts/${name}.js`,
      allowHelp: true,
    };

    fs.writeFileSync(policiesPath, JSON.stringify(policies, null, 2));
    console.log(`Registered ${name} in .clawmini/policies.json`);

    try {
      const foundPath = await resolveCompiledScript(name, import.meta.url);
      let scriptContent = fs.readFileSync(foundPath, 'utf8');

      if (!scriptContent.startsWith('#!')) {
        scriptContent = '#!/usr/bin/env node\n' + scriptContent;
      }

      const destPath = path.join(policyScriptsDir, `${name}.js`);
      fs.writeFileSync(destPath, scriptContent, { mode: 0o755 });
      console.log(`Copied ${name} script to ${destPath}`);
    } catch (err) {
      handleError('add policy', err);
    }
  });
