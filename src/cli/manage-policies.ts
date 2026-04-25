#!/usr/bin/env node
import { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  BUILTIN_POLICIES,
  type PolicyConfigFile,
  type PolicyDefinition,
} from '../shared/policies.js';
import { getClawminiDir } from '../shared/workspace.js';

const NAME_RE = /^[a-z0-9-]+$/;

const root = new Command('manage-policies');
root.description(
  'Manage clawmini policies. Subcommands: add, update, remove. Reads are unrestricted — use `clawmini-lite requests show <name>` instead.'
);

root
  .command('add')
  .description('Register a new policy. Errors if the name already exists.')
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
  1. Add a policy that wraps a shell command:
     clawmini-lite request manage-policies -- add --name npm-install --description "Run npm install" --command "npm install"

  2. Add a policy backed by a script file:
     clawmini-lite request manage-policies --file script=./install.sh -- add --name custom-install --description "Run custom install script" --script-file "{{script}}"

  3. Add a read-only policy that auto-approves and exposes --help:
     clawmini-lite request manage-policies -- add --name list-files --description "List files" --command "ls" --dangerously-auto-approve --dangerously-allow-help
`
  )
  .action((options) => {
    const name: string = options.name;
    const description: string = options.description;
    const commandStr: string | undefined = options.command;
    const scriptFile: string | undefined = options.scriptFile;
    const autoApprove = !!options.dangerouslyAutoApprove;
    const allowHelp = !!options.dangerouslyAllowHelp;

    assertValidName(name);

    if (!commandStr && !scriptFile) {
      fail('Must provide either --command or --script-file.');
    }
    if (commandStr && scriptFile) {
      fail('--command and --script-file are mutually exclusive.');
    }

    const { dirPath, policies, policiesPath } = loadPolicies();

    if (Object.prototype.hasOwnProperty.call(policies.policies, name)) {
      fail(
        `Policy '${name}' is already registered. Use 'manage-policies update' to modify it, or 'manage-policies remove' first.`
      );
    }

    const definition: PolicyDefinition = {
      description,
      allowHelp,
      autoApprove,
      command: '',
    };

    if (scriptFile) {
      definition.command = installScript(dirPath, name, scriptFile);
    } else if (commandStr) {
      applyCommandString(definition, commandStr);
    }

    policies.policies[name] = definition;
    writePolicies(policiesPath, policies);
    console.log(`Successfully added policy '${name}'.`);
  });

root
  .command('update')
  .description('Modify fields on an existing user-registered policy.')
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
     clawmini-lite request manage-policies -- update --name npm-install --description "Run npm install (with cache)"

  2. Replace the command:
     clawmini-lite request manage-policies -- update --name npm-install --command "npm ci"

  3. Toggle the dangerous flags:
     clawmini-lite request manage-policies -- update --name list-files --dangerously-auto-approve true --dangerously-allow-help true
`
  )
  .action((options) => {
    const name: string = options.name;
    const description: string | undefined = options.description;
    const commandStr: string | undefined = options.command;
    const scriptFile: string | undefined = options.scriptFile;
    const autoApprove = parseBoolFlag('--dangerously-auto-approve', options.dangerouslyAutoApprove);
    const allowHelp = parseBoolFlag('--dangerously-allow-help', options.dangerouslyAllowHelp);

    assertValidName(name);

    if (commandStr && scriptFile) {
      fail('--command and --script-file are mutually exclusive.');
    }

    const noChange =
      description === undefined &&
      commandStr === undefined &&
      scriptFile === undefined &&
      autoApprove === undefined &&
      allowHelp === undefined;
    if (noChange) {
      fail(
        'No fields specified to update. Pass at least one of --description, --command, --script-file, --dangerously-auto-approve, --dangerously-allow-help.'
      );
    }

    const { dirPath, policies, policiesPath } = loadPolicies();
    const existing = policies.policies[name];

    if (existing === undefined || existing === false) {
      // Built-ins are only modifiable by writing an explicit user override
      // (which is what `add` does). We refuse here so updates can't silently
      // shadow a built-in the user never opted into.
      fail(
        `No user-registered policy '${name}' to update. Use 'manage-policies add' to register one.`
      );
    }

    const updated: PolicyDefinition = { ...existing };
    if (description !== undefined) updated.description = description;
    if (scriptFile !== undefined) {
      updated.command = installScript(dirPath, name, scriptFile);
      delete updated.args;
    } else if (commandStr !== undefined) {
      delete updated.args;
      applyCommandString(updated, commandStr);
    }
    if (autoApprove !== undefined) updated.autoApprove = autoApprove;
    if (allowHelp !== undefined) updated.allowHelp = allowHelp;

    policies.policies[name] = updated;
    writePolicies(policiesPath, policies);
    console.log(`Successfully updated policy '${name}'.`);
  });

root
  .command('remove')
  .description('Remove (or disable) a registered policy.')
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
     clawmini-lite request manage-policies -- remove --name npm-install

  2. Disable a built-in policy (writes \`false\` to opt out):
     clawmini-lite request manage-policies -- remove --name manage-policies --disable-builtin

  3. Drop a user override of a built-in (the built-in then surfaces again):
     clawmini-lite request manage-policies -- remove --name manage-policies
`
  )
  .action((options) => {
    const name: string = options.name;
    const disableBuiltin: boolean = !!options.disableBuiltin;

    assertValidName(name);

    const { policies, policiesPath } = loadPolicies();
    const isBuiltin = name in BUILTIN_POLICIES;
    const existing = policies.policies[name];

    if (disableBuiltin) {
      if (!isBuiltin) {
        fail(
          `--disable-builtin can only be used for built-in policies; '${name}' is not a built-in.`
        );
      }
      if (existing === false) {
        fail(`Built-in policy '${name}' is already disabled.`);
      }
      policies.policies[name] = false;
      writePolicies(policiesPath, policies);
      console.log(`Successfully disabled built-in policy '${name}'.`);
      return;
    }

    if (existing === undefined) {
      const hint = isBuiltin
        ? ` '${name}' is a built-in. To opt out, re-run with --disable-builtin.`
        : '';
      fail(`No policy entry '${name}' to remove.${hint}`);
    }

    delete policies.policies[name];
    writePolicies(policiesPath, policies);

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

function assertValidName(name: string): void {
  if (!NAME_RE.test(name)) {
    fail('Policy name must only contain lowercase letters, numbers, and hyphens.');
  }
}

function loadPolicies(): {
  dirPath: string;
  policies: PolicyConfigFile;
  policiesPath: string;
} {
  const dirPath = getClawminiDir();
  const policiesPath = path.join(dirPath, 'policies.json');
  if (!fs.existsSync(dirPath)) {
    fail('.clawmini directory not found. Please run "clawmini init" first.');
  }
  let policies: PolicyConfigFile = { policies: {} };
  if (fs.existsSync(policiesPath)) {
    policies = JSON.parse(fs.readFileSync(policiesPath, 'utf8'));
  }
  return { dirPath, policies, policiesPath };
}

function writePolicies(policiesPath: string, policies: PolicyConfigFile): void {
  fs.writeFileSync(policiesPath, JSON.stringify(policies, null, 2));
}

function installScript(dirPath: string, name: string, scriptFile: string): string {
  const scriptsDir = path.join(dirPath, 'policy-scripts');
  if (!fs.existsSync(scriptsDir)) {
    fs.mkdirSync(scriptsDir, { recursive: true });
  }
  const ext = path.extname(scriptFile) || '.sh';
  const destScript = path.join(scriptsDir, `${name}${ext}`);
  fs.copyFileSync(scriptFile, destScript);
  fs.chmodSync(destScript, 0o755);
  return `./.clawmini/policy-scripts/${path.basename(destScript)}`;
}

function applyCommandString(definition: PolicyDefinition, commandStr: string): void {
  const parts = commandStr.split(' ');
  definition.command = parts[0] || '';
  if (parts.length > 1) {
    definition.args = parts.slice(1);
  }
}

function parseBoolFlag(flag: string, value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const lower = value.toLowerCase();
  if (lower === 'true') return true;
  if (lower === 'false') return false;
  fail(`${flag} must be 'true' or 'false', got '${value}'.`);
}

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  root.parse(process.argv);
}
