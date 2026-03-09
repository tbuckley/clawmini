import { Command } from 'commander';
import { getDaemonClient } from '../client.js';
import { spawn } from 'node:child_process';
import { handleError } from '../utils.js';

export const requestsCmd = new Command('requests').description('Manage sandbox policy requests');

requestsCmd
  .command('list')
  .description('List available policies')
  .action(async () => {
    try {
      const client = await getDaemonClient();
      const config = await client.listPolicies.query();

      if (!config || !config.policies || Object.keys(config.policies).length === 0) {
        console.log('No policies configured.');
        return;
      }

      console.log('Available Policies:\n');
      for (const [name, policy] of Object.entries(config.policies)) {
        console.log(`- ${name}`);
        if (policy.description) {
          console.log(`  Description: ${policy.description}`);
        }
        const cmdString = `${policy.command} ${policy.args ? policy.args.join(' ') : ''}`.trim();
        console.log(`  Command: ${cmdString}`);
      }
    } catch (err) {
      handleError('list policies', err);
    }
  });

export const requestCmd = new Command('request')
  .description('Submit a sandbox policy request')
  .argument('<cmd>', 'The policy command name to request')
  .option('--help', 'Execute the underlying command with --help and print the output')
  .option('-f, --file <mappings...>', 'File mappings in the format name=path')
  .allowUnknownOption()
  .allowExcessArguments(true)
  .helpOption('-h, --cli-help', 'display CLI help for command')
  .action(async (cmdName, options, command) => {
    try {
      const client = await getDaemonClient();
      const config = await client.listPolicies.query();
      const policy = config?.policies?.[cmdName];

      if (!policy) {
        throw new Error(`Policy not found: ${cmdName}`);
      }

      if (options.help) {
        // Execute underlying command with --help
        const p = spawn(policy.command, [...(policy.args || []), '--help'], { stdio: 'inherit' });
        await new Promise((resolve) => p.on('close', resolve));
        return;
      }

      const dashDashIndex = process.argv.indexOf('--');
      const opaqueArgs =
        dashDashIndex !== -1 ? process.argv.slice(dashDashIndex + 1) : command.args.slice(1);

      const fileMappings: Record<string, string> = {};
      if (options.file) {
        for (const mapping of options.file) {
          const [name, ...pathParts] = mapping.split('=');
          const pathStr = pathParts.join('=');
          if (!name || !pathStr) {
            throw new Error(`Invalid file mapping: ${mapping}. Expected format name=path`);
          }
          fileMappings[name] = pathStr;
        }
      }

      const request = await client.createPolicyRequest.mutate({
        commandName: cmdName,
        args: opaqueArgs,
        fileMappings,
      });

      console.log(`Request created successfully.`);
      console.log(`Request ID: ${request.id}`);
    } catch (err) {
      handleError('request policy', err);
    }
  });
