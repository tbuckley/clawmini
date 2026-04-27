#!/usr/bin/env node
import { Command } from 'commander';
import { pathToFileURL } from 'node:url';
import { BUILTIN_POLICIES, type PolicyDefinition } from '../shared/policies.js';
import {
  applyCommandString,
  assertValidName,
  fail,
  installScript,
  loadPolicies,
  scriptInsidePolicyScripts,
  unlinkIfExists,
  writePolicies,
} from './manage-policies-utils.js';

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
    '--dangerously-auto-approve',
    'Enable autoApprove. Only safe for fully sandboxed, side-effect-free commands.'
  )
  .option('--no-dangerously-auto-approve', 'Disable autoApprove.')
  .option(
    '--dangerously-allow-help',
    'Enable allowHelp. Only safe if the underlying command treats `--help` as read-only.'
  )
  .option('--no-dangerously-allow-help', 'Disable allowHelp.')
  .addHelpText(
    'after',
    `
Examples:
  1. Update the description of an existing policy:
     clawmini-lite request manage-policies -- update --name npm-install --description "Run npm install (with cache)"

  2. Replace the command:
     clawmini-lite request manage-policies -- update --name npm-install --command "npm ci"

  3. Enable the dangerous flags:
     clawmini-lite request manage-policies -- update --name list-files --dangerously-auto-approve --dangerously-allow-help

  4. Turn a dangerous flag off again:
     clawmini-lite request manage-policies -- update --name list-files --no-dangerously-auto-approve
`
  )
  .action((options) => {
    const name: string = options.name;
    const description: string | undefined = options.description;
    const commandStr: string | undefined = options.command;
    const scriptFile: string | undefined = options.scriptFile;
    const autoApprove: boolean | undefined = options.dangerouslyAutoApprove;
    const allowHelp: boolean | undefined = options.dangerouslyAllowHelp;

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

    if (existing === false) {
      // The user previously disabled this entry with `remove --disable-builtin`.
      // We don't auto-clear that here — the agent must reaffirm intent via remove
      // (which clears the false) and then add. Otherwise an update could silently
      // re-enable a policy the user explicitly opted out of.
      fail(
        `Policy '${name}' is currently disabled. Run 'manage-policies remove --name ${name}' to clear the disable, then 'manage-policies add' to register it.`
      );
    }
    if (existing === undefined) {
      // Built-ins are only modifiable by writing an explicit user override
      // (which is what `add` does). We refuse here so updates can't silently
      // shadow a built-in the user never opted into.
      fail(
        `No user-registered policy '${name}' to update. Use 'manage-policies add' to register one.`
      );
    }

    // Capture before mutating: if the policy currently points at a managed
    // script file, we may need to unlink it after replacing the command.
    const priorScriptAbs = scriptInsidePolicyScripts(dirPath, existing.command);

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

    // Now that policies.json points at the new command, drop the orphaned
    // prior script (e.g. `<name>.sh` left behind when updating to `<name>.py`,
    // or any script file when switching to --command). Done after the json
    // write so a failure here cannot strand policies.json pointing at a
    // file we just deleted.
    const newScriptAbs = scriptInsidePolicyScripts(dirPath, updated.command);
    if (priorScriptAbs && priorScriptAbs !== newScriptAbs) {
      unlinkIfExists(priorScriptAbs);
    }

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
      // A user override (object) is a deliberate customization; silently
      // replacing it with `false` would destroy approved work. Force the
      // agent to drop the override first, then re-run with --disable-builtin.
      if (existing !== undefined) {
        fail(
          `Policy '${name}' has a user override that would be lost. Run 'manage-policies remove --name ${name}' first, then re-run with --disable-builtin.`
        );
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  root.parse(process.argv);
}
