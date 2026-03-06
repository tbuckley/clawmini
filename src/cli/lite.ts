#!/usr/bin/env node

import { Command } from 'commander';
import { createTRPCClient, httpLink } from '@trpc/client';
import type { AppRouter } from '../daemon/router.js';
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

const jobs = program.command('jobs').description('Manage cron jobs');

jobs
  .command('list')
  .description('List cron jobs')
  .action(async () => {
    try {
      const client = getClient();
      const jobsList = await client.listCronJobs.query({});
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
      await client.addCronJob.mutate({ chatId: options.chat, job });
      console.log(`Job '${name}' created successfully.`);
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

jobs
  .command('delete <name>')
  .description('Delete a cron job')
  .option('-c, --chat <chatId>', 'Chat ID')
  .action(async (name, options) => {
    try {
      const client = getClient();
      const result = await client.deleteCronJob.mutate({ chatId: options.chat, id: name });
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

program.parse(process.argv);
