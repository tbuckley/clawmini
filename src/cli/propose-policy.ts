#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);

if (args.includes('--help')) {
  console.log(`Usage: clawmini-lite request propose-policy -- --name <policy_name> --description <description> [--command <command_string>] [--script-file <path>]

Proposes and registers a new policy.

Arguments:
  --name          (Required) Name of the policy
  --description   (Required) Description of the policy
  --command       (Optional) The shell command to run (e.g. "npm install -g")
  --script-file   (Optional) Path to a script file (mapped securely via --file)

Examples:
  1. Propose a policy using a direct shell command:
     clawmini-lite request propose-policy -- --name npm-install --description "Run npm install" --command "npm install"

  2. Propose a policy using a custom script file:
     # First, write your script to a file (e.g., install.sh)
     clawmini-lite request propose-policy --file script=./install.sh -- --name custom-install --description "Run custom install script" --script-file "{{script}}"
`);
  process.exit(0);
}

let name: string | undefined;
let description: string | undefined;
let commandStr: string | undefined;
let scriptFile: string | undefined;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--name') name = args[++i];
  else if (args[i] === '--description') description = args[++i];
  else if (args[i] === '--command') commandStr = args[++i];
  else if (args[i] === '--script-file') scriptFile = args[++i];
}

if (!name || !description) {
  console.error('Error: --name and --description are required.');
  process.exit(1);
}

if (!commandStr && !scriptFile) {
  console.error('Error: Must provide either --command or --script-file.');
  process.exit(1);
}

const cwd = process.cwd();
const policiesPath = path.join(cwd, '.clawmini', 'policies.json');

let policies: { policies: Record<string, unknown> } = { policies: {} };
if (fs.existsSync(policiesPath)) {
  policies = JSON.parse(fs.readFileSync(policiesPath, 'utf8'));
}

const policyConfig: Record<string, unknown> = {
  description,
  allowHelp: true,
};

if (scriptFile) {
  const scriptsDir = path.join(cwd, '.clawmini', 'policy-scripts');
  if (!fs.existsSync(scriptsDir)) {
    fs.mkdirSync(scriptsDir, { recursive: true });
  }

  const ext = path.extname(scriptFile) || '.sh';
  const destScript = path.join(scriptsDir, `${name}${ext}`);
  fs.copyFileSync(scriptFile, destScript);
  fs.chmodSync(destScript, 0o755);

  policyConfig.command = `./.clawmini/policy-scripts/${path.basename(destScript)}`;
} else if (commandStr) {
  const parts = commandStr.split(' ');
  policyConfig.command = parts[0];
  if (parts.length > 1) {
    policyConfig.args = parts.slice(1);
  }
}

policies.policies[name] = policyConfig;
fs.writeFileSync(policiesPath, JSON.stringify(policies, null, 2));
console.log(`Successfully proposed and registered policy '${name}'.`);
