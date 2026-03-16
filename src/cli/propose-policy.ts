#!/usr/bin/env node
import { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import type { PolicyConfig, PolicyDefinition } from '../shared/policies.js';
import { getClawminiDir } from '../shared/workspace.js';

const program = new Command();

program
  .name('propose-policy')
  .description('Proposes and registers a new policy.')
  .requiredOption('--name <policy_name>', 'Name of the policy')
  .requiredOption('--description <description>', 'Description of the policy')
  .option('--command <command_string>', 'The shell command to run (e.g. "npm install -g")')
  .option('--script-file <path>', 'Path to a script file (mapped securely via --file)')
  .addHelpText(
    'after',
    `
Examples:
  1. Propose a policy using a direct shell command:
     clawmini-lite request propose-policy -- --name npm-install --description "Run npm install" --command "npm install"

  2. Propose a policy using a custom script file:
     # First, write your script to a file (e.g., install.sh)
     clawmini-lite request propose-policy --file script=./install.sh -- --name custom-install --description "Run custom install script" --script-file "{{script}}"
`
  )
  .parse(process.argv);

const options = program.opts();

const name = options.name;
const description = options.description;
const commandStr = options.command;
const scriptFile = options.scriptFile;

if (!/^[a-z0-9-]+$/.test(name)) {
  console.error('Error: Policy name must only contain lowercase letters, numbers, and hyphens.');
  process.exit(1);
}

if (!commandStr && !scriptFile) {
  console.error('Error: Must provide either --command or --script-file.');
  process.exit(1);
}

const dirPath = getClawminiDir();
const policiesPath = path.join(dirPath, 'policies.json');

let policies: PolicyConfig = { policies: {} };
if (fs.existsSync(policiesPath)) {
  policies = JSON.parse(fs.readFileSync(policiesPath, 'utf8'));
}

const policyDefinition: PolicyDefinition = {
  description,
  allowHelp: true,
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
