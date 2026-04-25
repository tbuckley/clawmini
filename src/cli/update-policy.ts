#!/usr/bin/env node
import { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { PolicyConfigFile, PolicyDefinition } from '../shared/policies.js';
import { getClawminiDir } from '../shared/workspace.js';

const updatePolicyCmd = new Command('update-policy');

updatePolicyCmd
  .description('Updates an existing user-registered policy.')
  .requiredOption('--name <policy_name>', 'Name of the policy to update')
  .option('--description <description>', 'New description')
  .option('--command <command_string>', 'Replace the shell command (e.g. "npm install -g")')
  .option('--script-file <path>', 'Replace the policy with a script file (mapped via --file)')
  .option(
    '--dangerously-auto-approve <bool>',
    'Set autoApprove (true|false). Only safe for fully sandboxed, side-effect-free commands.'
  )
  .option(
    '--dangerously-allow-help <bool>',
    'Set allowHelp (true|false). Only safe if the underlying command treats `--help` as read-only.'
  )
  .addHelpText(
    'after',
    `
Examples:
  1. Update the description of an existing policy:
     clawmini-lite request update-policy -- --name npm-install --description "Run npm install (now with cache)"

  2. Replace the command:
     clawmini-lite request update-policy -- --name npm-install --command "npm ci"

  3. Replace with a script file:
     clawmini-lite request update-policy --file script=./install.sh -- --name custom-install --script-file "{{script}}"

  4. Toggle the dangerous flags:
     clawmini-lite request update-policy -- --name list-files --dangerously-auto-approve true --dangerously-allow-help true
`
  )
  .action((options) => {
    const name = options.name;

    if (!/^[a-z0-9-]+$/.test(name)) {
      console.error(
        'Error: Policy name must only contain lowercase letters, numbers, and hyphens.'
      );
      process.exit(1);
    }

    const description: string | undefined = options.description;
    const commandStr: string | undefined = options.command;
    const scriptFile: string | undefined = options.scriptFile;
    const autoApproveRaw: string | undefined = options.dangerouslyAutoApprove;
    const allowHelpRaw: string | undefined = options.dangerouslyAllowHelp;

    if (commandStr && scriptFile) {
      console.error('Error: --command and --script-file are mutually exclusive.');
      process.exit(1);
    }

    const autoApprove = parseBoolFlag('--dangerously-auto-approve', autoApproveRaw);
    const allowHelp = parseBoolFlag('--dangerously-allow-help', allowHelpRaw);

    const noChange =
      description === undefined &&
      commandStr === undefined &&
      scriptFile === undefined &&
      autoApprove === undefined &&
      allowHelp === undefined;
    if (noChange) {
      console.error(
        'Error: No fields specified to update. Pass at least one of --description, --command, --script-file, --dangerously-auto-approve, --dangerously-allow-help.'
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

    const existing = policies.policies[name];
    if (existing === undefined || existing === false) {
      // Built-ins are only modifiable by writing an explicit user override
      // (which is what `propose-policy` does). We refuse here so updates
      // can't silently shadow a built-in the user never opted into.
      console.error(
        `Error: No user-registered policy '${name}' to update. Use propose-policy to register one.`
      );
      process.exit(1);
    }

    const updated: PolicyDefinition = { ...existing };

    if (description !== undefined) updated.description = description;

    if (scriptFile !== undefined) {
      const scriptsDir = path.join(dirPath, 'policy-scripts');
      if (!fs.existsSync(scriptsDir)) {
        fs.mkdirSync(scriptsDir, { recursive: true });
      }

      const ext = path.extname(scriptFile) || '.sh';
      const destScript = path.join(scriptsDir, `${name}${ext}`);
      fs.copyFileSync(scriptFile, destScript);
      fs.chmodSync(destScript, 0o755);

      updated.command = `./.clawmini/policy-scripts/${path.basename(destScript)}`;
      delete updated.args;
    } else if (commandStr !== undefined) {
      const parts = commandStr.split(' ');
      updated.command = parts[0] || '';
      if (parts.length > 1) {
        updated.args = parts.slice(1);
      } else {
        delete updated.args;
      }
    }

    if (autoApprove !== undefined) updated.autoApprove = autoApprove;
    if (allowHelp !== undefined) updated.allowHelp = allowHelp;

    policies.policies[name] = updated;
    fs.writeFileSync(policiesPath, JSON.stringify(policies, null, 2));
    console.log(`Successfully updated policy '${name}'.`);
  });

function parseBoolFlag(flag: string, value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const lower = value.toLowerCase();
  if (lower === 'true') return true;
  if (lower === 'false') return false;
  console.error(`Error: ${flag} must be 'true' or 'false', got '${value}'.`);
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  updatePolicyCmd.parse(process.argv);
}
