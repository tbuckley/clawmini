#!/usr/bin/env node
import { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BUILTIN_POLICIES, type PolicyConfigFile } from '../shared/policies.js';
import { getClawminiDir } from '../shared/workspace.js';

const removePolicyCmd = new Command('remove-policy');

removePolicyCmd
  .description('Removes a registered policy.')
  .requiredOption('--name <policy_name>', 'Name of the policy to remove')
  .option(
    '--disable-builtin',
    'When the name matches a built-in policy, write `false` to opt out instead of just deleting the user override.',
    false
  )
  .addHelpText(
    'after',
    `
Examples:
  1. Remove a user-registered policy:
     clawmini-lite request remove-policy -- --name npm-install

  2. Disable a built-in policy (writes \`false\` to opt out):
     clawmini-lite request remove-policy -- --name propose-policy --disable-builtin

  3. Drop a user override of a built-in (the built-in then surfaces again):
     clawmini-lite request remove-policy -- --name propose-policy
`
  )
  .action((options) => {
    const name = options.name;
    const disableBuiltin: boolean = !!options.disableBuiltin;

    if (!/^[a-z0-9-]+$/.test(name)) {
      console.error(
        'Error: Policy name must only contain lowercase letters, numbers, and hyphens.'
      );
      process.exit(1);
    }

    const dirPath = getClawminiDir();
    const policiesPath = path.join(dirPath, 'policies.json');

    if (!fs.existsSync(dirPath)) {
      console.error('Error: .clawmini directory not found. Please run "clawmini init" first.');
      process.exit(1);
    }

    let policies: PolicyConfigFile = { policies: {} };
    if (fs.existsSync(policiesPath)) {
      policies = JSON.parse(fs.readFileSync(policiesPath, 'utf8'));
    }

    const isBuiltin = name in BUILTIN_POLICIES;
    const existing = policies.policies[name];

    if (disableBuiltin) {
      if (!isBuiltin) {
        console.error(
          `Error: --disable-builtin can only be used for built-in policies; '${name}' is not a built-in.`
        );
        process.exit(1);
      }
      if (existing === false) {
        console.error(`Error: Built-in policy '${name}' is already disabled.`);
        process.exit(1);
      }
      policies.policies[name] = false;
      fs.writeFileSync(policiesPath, JSON.stringify(policies, null, 2));
      console.log(`Successfully disabled built-in policy '${name}'.`);
      return;
    }

    if (existing === undefined) {
      const hint = isBuiltin
        ? ` '${name}' is a built-in. To opt out, re-run with --disable-builtin.`
        : '';
      console.error(`Error: No policy entry '${name}' to remove.${hint}`);
      process.exit(1);
    }

    delete policies.policies[name];
    fs.writeFileSync(policiesPath, JSON.stringify(policies, null, 2));

    if (existing === false) {
      console.log(
        `Successfully cleared the disable entry for '${name}'.${
          isBuiltin ? ' The built-in will surface again.' : ''
        }`
      );
    } else if (isBuiltin) {
      console.log(
        `Successfully removed user override of built-in policy '${name}'. The built-in will surface again.`
      );
    } else {
      console.log(`Successfully removed policy '${name}'.`);
    }
  });

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  removePolicyCmd.parse(process.argv);
}
