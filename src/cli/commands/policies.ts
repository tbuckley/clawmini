import { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import { handleError } from '../utils.js';
import { resolveCompiledScript } from '../../shared/lite.js';
import { BUILTIN_POLICIES, type PolicyConfig } from '../../shared/policies.js';
import { getClawminiDir } from '../../shared/workspace.js';

const SUPPORTED_POLICIES = ['manage-policies'];

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

    const builtin = BUILTIN_POLICIES[name];
    policies.policies[name] = {
      description: builtin?.description ?? `Built-in policy ${name}`,
      command: `./.clawmini/policy-scripts/${name}.js`,
      allowHelp: builtin?.allowHelp ?? true,
      ...(builtin?.autoApprove !== undefined ? { autoApprove: builtin.autoApprove } : {}),
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
