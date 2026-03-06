#!/usr/bin/env node

import { Command } from 'commander';

/**
 * clawmini-lite - A standalone client
 */
const API_URL = process.env.CLAW_API_URL;
const API_TOKEN = process.env.CLAW_API_TOKEN;

async function trpcCall(endpoint: string, method: string = 'POST', input: unknown = undefined) {
  let url = `${API_URL}/${endpoint}`;
  const options: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      'Content-Type': 'application/json',
    },
  };

  if (method === 'GET') {
    if (input !== undefined) {
      url += `?batch=1&input=${encodeURIComponent(JSON.stringify({ '0': input }))}`;
    }
  } else {
    if (input !== undefined) {
      options.body = JSON.stringify(input);
    }
  }

  const res = await fetch(url, options);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Failed to parse response: ${text}`);
  }

  if (!res.ok) {
    const isBatched = method === 'GET';
    const errMsg =
      (isBatched ? data?.[0]?.error?.message : data?.error?.message) ||
      `HTTP ${res.status} ${res.statusText}`;
    throw new Error(errMsg);
  }

  if (method === 'GET') {
    return data[0].result.data;
  }
  return data.result.data;
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
  .command('log <message>')
  .description('Log a message')
  .option('-f, --file <path>', 'File path(s) to attach (can specify multiple)', (val: string, prev: string[]) => prev.concat([val]), [])
  .action(async (message, options) => {
    try {
      const files = options.file.length > 0 ? options.file : undefined;
      await trpcCall('logMessage', 'POST', { message, files });
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
      const jobsList = await trpcCall('listCronJobs', 'GET', {});
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
  .option('-e, --env <env>', 'Environment variables in key=value format', (val: string, prev: string[]) => prev.concat([val]), [])
  .option('-c, --chat <chatId>', 'Chat ID')
  .action(async (name, options) => {
    try {
      let schedule;
      if (options.at) schedule = { at: options.at };
      else if (options.every) schedule = { every: options.every };
      else if (options.cron) schedule = { cron: options.cron };
      else throw new Error('A schedule must be specified (--at, --every, or --cron).');

      const job: Record<string, unknown> = {
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

      await trpcCall('addCronJob', 'POST', { chatId: options.chat, job });
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
      const result = (await trpcCall('deleteCronJob', 'POST', { chatId: options.chat, id: name })) as {
        deleted: boolean;
      };
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
