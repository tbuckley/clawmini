#!/usr/bin/env node
/* eslint-disable max-lines */

import { Command } from 'commander';
import { createTRPCClient, httpLink } from '@trpc/client';
import type { AgentRouter as AppRouter } from '../daemon/api/index.js';
import type { CronJob } from '../shared/config.js';

/**
 * clawmini-lite - A standalone client
 */
const API_URL = process.env.CLAW_API_URL;
const API_TOKEN = process.env.CLAW_API_TOKEN;

function getClient() {
  return createTRPCClient<AppRouter>({
    links: [
      httpLink({
        url: API_URL as string,
        headers() {
          return {
            Authorization: `Bearer ${API_TOKEN}`,
            'Content-Type': 'application/json',
          };
        },
      }),
    ],
  });
}

const program = new Command();

program
  .name('clawmini-lite')
  .description('A standalone client for clawmini')
  .hook('preAction', () => {
    if (!API_URL || !API_TOKEN) {
      console.error('CLAW_API_URL and CLAW_API_TOKEN must be set in the environment.');
      process.exit(1);
    }
  });

program
  .command('log [message]')
  .description('Log a message')
  .option(
    '-f, --file <path>',
    'File path(s) to attach (can specify multiple)',
    (val: string, prev: string[]) => prev.concat([val]),
    []
  )
  .action(async (message, options) => {
    try {
      const files = options.file.length > 0 ? options.file : undefined;
      const payload: { message?: string; files?: string[] } = {};
      if (message !== undefined) payload.message = message;
      if (files !== undefined) payload.files = files;

      const client = getClient();
      await client.logMessage.mutate(payload);
      console.log('Log message appended.');
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program
  .command('fetch-pending')
  .description('Fetch pending messages and output them as formatted strings')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.fetchPendingMessages.mutate();
      if (result && result.messages) {
        process.stdout.write(result.messages);
        if (!result.messages.endsWith('\n')) {
          process.stdout.write('\n');
        }
      }
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

const jobs = program.command('jobs').description('Manage cron jobs');

jobs
  .command('list')
  .description('List cron jobs')
  .action(async () => {
    try {
      const client = getClient();
      const jobsList = await client.listCronJobs.query();
      console.log(JSON.stringify(jobsList, null, 2));
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

jobs
  .command('add <name>')
  .description('Add a cron job')
  .option('--at <time>', 'Schedule at specific time')
  .option('--every <interval>', 'Schedule at interval')
  .option('--cron <cron>', 'Schedule via cron expression')
  .option('-m, --message <msg>', 'Message to send')
  .option('-r, --reply <reply>', 'Reply text')
  .option('-a, --agent <agentId>', 'Agent ID')
  .option('-s, --session <type>', 'Session type (must be "new")')
  .option(
    '-e, --env <env>',
    'Environment variables in key=value format',
    (val: string, prev: string[]) => prev.concat([val]),
    []
  )
  .option('-c, --chat <chatId>', 'Chat ID')
  .action(async (name, options) => {
    try {
      let schedule;
      if (options.at) schedule = { at: options.at };
      else if (options.every) schedule = { every: options.every };
      else if (options.cron) schedule = { cron: options.cron };
      else throw new Error('A schedule must be specified (--at, --every, or --cron).');

      const job: CronJob = {
        id: name,
        createdAt: new Date().toISOString(),
        message: options.message || '',
        schedule,
      };

      if (options.reply) job.reply = options.reply;
      if (options.agent) job.agentId = options.agent;
      if (options.session) {
        if (options.session !== 'new') throw new Error('Only "new" session type is supported.');
        job.session = { type: 'new' };
      }

      if (options.env && options.env.length > 0) {
        const jobEnv: Record<string, string> = {};
        for (const e of options.env) {
          const [k, ...v] = e.split('=');
          if (k) jobEnv[k] = v.join('=');
        }
        job.env = jobEnv;
      }

      const client = getClient();
      await client.addCronJob.mutate({ job });
      console.log(`Job '${name}' created successfully.`);
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

jobs
  .command('delete <name>')
  .description('Delete a cron job')
  .action(async (name) => {
    try {
      const client = getClient();
      const result = await client.deleteCronJob.mutate({ id: name });
      if (result && result.deleted) {
        console.log(`Job '${name}' deleted successfully.`);
      } else {
        console.log(`Job '${name}' not found.`);
      }
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

const requests = program.command('requests').description('Manage sandbox policy requests');

requests
  .command('list')
  .description('List available policies')
  .action(async () => {
    try {
      const client = getClient();
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
      }
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program
  .command('request <cmd>')
  .description('Submit a sandbox policy request')
  .option('--help', 'Execute the underlying command with --help and print the output')
  .option('-f, --file <mappings...>', 'File mappings in the format name=path')
  .allowUnknownOption()
  .allowExcessArguments(true)
  .helpOption('-h, --cli-help', 'display CLI help for command')
  .action(async (cmdName, options, command) => {
    try {
      const client = getClient();
      const config = await client.listPolicies.query();
      const policy = config?.policies?.[cmdName];

      if (!policy) {
        throw new Error(`Policy not found: ${cmdName}`);
      }

      if (options.help) {
        // Execute underlying command with --help via the daemon
        const helpOutput = await client.executePolicyHelp.query({ commandName: cmdName });
        if (helpOutput.stdout) {
          process.stdout.write(helpOutput.stdout);
        }
        if (helpOutput.stderr) {
          process.stderr.write(helpOutput.stderr);
        }
        process.exit(helpOutput.exitCode);
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

      if (request.executionResult) {
        if (request.executionResult.stdout) {
          process.stdout.write(request.executionResult.stdout);
        }
        if (request.executionResult.stderr) {
          process.stderr.write(request.executionResult.stderr);
        }
        process.exit(request.executionResult.exitCode);
      } else {
        console.log(`Request created successfully.`);
        console.log(`Request ID: ${request.id}`);
      }
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

const subagents = program.command('subagents').description('Manage subagents');

subagents
  .command('add <message>')
  .description('Add a subagent')
  .option('-a, --agent <agent>', 'Agent to use for the subagent')
  .action(async (message, options) => {
    try {
      const client = getClient();
      const result = await client.subagents.add.mutate({
        message,
        agent: options.agent,
      });
      console.log(`Subagent created with ID: ${result.subagentId}`);
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

subagents
  .command('list')
  .description('List subagents')
  .action(async () => {
    try {
      const client = getClient();
      const list = await client.subagents.list.query();
      console.log(JSON.stringify(list, null, 2));
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

subagents
  .command('tail <id>')
  .description('Tail a subagent')
  .option('-n, --lines <number>', 'Number of lines to tail', parseInt)
  .action(async (id, options) => {
    try {
      const client = getClient();
      const messages = await client.subagents.tail.query({ subagentId: id, limit: options.lines });
      console.log(JSON.stringify(messages, null, 2));
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

subagents
  .command('send <id> <message>')
  .description('Send a follow-up message to a subagent')
  .action(async (id, message) => {
    try {
      const client = getClient();
      await client.subagents.send.mutate({ subagentId: id, message });
      console.log('Message sent.');
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

subagents
  .command('stop <id>')
  .description('Stop a subagent')
  .action(async (id) => {
    try {
      const client = getClient();
      await client.subagents.stop.mutate({ subagentId: id });
      console.log('Subagent stopped.');
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

subagents
  .command('delete <id>')
  .description('Delete a subagent')
  .action(async (id) => {
    try {
      const client = getClient();
      await client.subagents.delete.mutate({ subagentId: id });
      console.log('Subagent deleted.');
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program.parse(process.argv);
