import { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleError } from '../utils.js';

export const policiesCmd = new Command('policies').description('Manage sandbox policies');

policiesCmd
  .command('add <name>')
  .description('Add a new policy')
  .action(async (name: string) => {
    if (name !== 'propose-policy') {
      handleError('add policy', new Error('Currently only "propose-policy" is supported.'));
    }

    const cwd = process.cwd();
    const dirPath = path.join(cwd, '.clawmini');
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
    let policies: { policies: Record<string, unknown> } = { policies: {} };
    if (fs.existsSync(policiesPath)) {
      policies = JSON.parse(fs.readFileSync(policiesPath, 'utf8'));
    }

    policies.policies['propose-policy'] = {
      description: 'Propose a new policy to create',
      command: './.clawmini/policy-scripts/propose-policy.mjs',
      allowHelp: true,
    };

    fs.writeFileSync(policiesPath, JSON.stringify(policies, null, 2));
    console.log('Registered propose-policy in .clawmini/policies.json');

    // Load and write propose-policy.mjs
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    let scriptContent;

    // Search for the compiled script in similar locations as lite.mjs
    const searchPaths = [
      path.resolve(__dirname, 'propose-policy.mjs'), // If compiled next to this file
      path.resolve(__dirname, '../propose-policy.mjs'), // If compiled one level up
      path.resolve(__dirname, '../../propose-policy.mjs'), // If compiled two levels up
      path.resolve(__dirname, '../../dist/cli/propose-policy.mjs'), // Source execution fallback
    ];

    let foundPath = '';
    for (const p of searchPaths) {
      if (fs.existsSync(p)) {
        foundPath = p;
        break;
      }
    }

    if (!foundPath) {
      handleError(
        'add policy',
        new Error(
          'Could not find compiled propose-policy script. Ensure you have run "npm run build".'
        )
      );
    }

    try {
      scriptContent = fs.readFileSync(foundPath, 'utf8');
      if (!scriptContent.startsWith('#!')) {
        scriptContent = '#!/usr/bin/env node\n' + scriptContent;
      }

      const destPath = path.join(policyScriptsDir, 'propose-policy.mjs');
      fs.writeFileSync(destPath, scriptContent, { mode: 0o755 });
      console.log(`Copied propose-policy script to ${destPath}`);
    } catch (err) {
      handleError('add policy', err);
    }
  });
