#!/usr/bin/env node
import { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { PolicyConfigFile, PolicyDefinition } from '../shared/policies.js';
import { getClawminiDir } from '../shared/workspace.js';

const proposePolicyCmd = new Command('propose-policy');

proposePolicyCmd
  .description('Proposes and registers a new policy.')
  .requiredOption('--name <policy_name>', 'Name of the policy')
  .requiredOption('--description <description>', 'Description of the policy')
  .option('--command <command_string>', 'The shell command to run (e.g. "npm install -g")')
  .option('--script-file <path>', 'Path to a script file (mapped securely via --file)')
  .option(
    '--dangerously-auto-approve',
    'Skip user approval for every invocation of this policy. Only safe for fully sandboxed, side-effect-free commands.',
    false
  )
  .option(
    '--dangerously-allow-help',
    'Allow the agent to run the policy with `--help` without approval. Only safe if the underlying command treats `--help` as read-only.',
    false
  )
  .addHelpText(
    'after',
    `
Examples:
  1. Propose a policy using a direct shell command:
     clawmini-lite request propose-policy -- --name npm-install --description "Run npm install" --command "npm install"

  2. Propose a policy using a custom script file:
     # First, write your script to a file (e.g., install.sh)
     clawmini-lite request propose-policy --file script=./install.sh -- --name custom-install --description "Run custom install script" --script-file "{{script}}"

  3. Propose a policy that auto-approves and allows --help discovery:
     clawmini-lite request propose-policy -- --name list-files --description "List files" --command "ls" --dangerously-auto-approve --dangerously-allow-help
`
  )
  .action((options) => {
    const name = options.name;
    const description = options.description;
    const commandStr = options.command;
    const scriptFile = options.scriptFile;
    const autoApprove = !!options.dangerouslyAutoApprove;
    const allowHelp = !!options.dangerouslyAllowHelp;

    if (!/^[a-z0-9-]+$/.test(name)) {
      console.error(
        'Error: Policy name must only contain lowercase letters, numbers, and hyphens.'
      );
      process.exit(1);
    }

    if (!commandStr && !scriptFile) {
      console.error('Error: Must provide either --command or --script-file.');
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

    const policyDefinition: PolicyDefinition = {
      description,
      allowHelp,
      autoApprove,
      command: '',
    };

    if (scriptFile) {
      const scriptsDir = path.join(dirPath, 'policy-scripts');
      if (!fs.existsSync(scriptsDir)) {
        fs.mkdirSync(scriptsDir, { recursive: true });
      }

      const ext = path.extname(scriptFile) || '.sh';
      const destScript = path.join(scriptsDir, `${name}${ext}`);
      fs.copyFileSync(scriptFile, destScript);
      fs.chmodSync(destScript, 0o755);

      policyDefinition.command = `./.clawmini/policy-scripts/${path.basename(destScript)}`;
    } else if (commandStr) {
      const parts = commandStr.split(' ');
      if (parts[0]) {
        policyDefinition.command = parts[0];
      }
      if (parts.length > 1) {
        policyDefinition.args = parts.slice(1);
      }
    }

    policies.policies[name] = policyDefinition;
    fs.writeFileSync(policiesPath, JSON.stringify(policies, null, 2));
    console.log(`Successfully proposed and registered policy '${name}'.`);
  });

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  proposePolicyCmd.parse(process.argv);
}
