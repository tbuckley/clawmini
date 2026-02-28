import { Command } from 'commander';
import { getDaemonClient } from '../client.js';
import type { CronJob } from '../../shared/config.js';

export const cronCmd = new Command('cron').description('Manage cron jobs');

function parseEnv(envArray: string[] | undefined): Record<string, string> | undefined {
  if (!envArray || envArray.length === 0) return undefined;
  const env: Record<string, string> = {};
  for (const e of envArray) {
    const [key, ...rest] = e.split('=');
    if (key && rest.length >= 0) {
      env[key] = rest.join('=');
    }
  }
  return env;
}

function parseSession(sessionArray: string[] | undefined): Record<string, string> | undefined {
  if (!sessionArray || sessionArray.length === 0) return undefined;
  const session: Record<string, string> = {};
  for (const s of sessionArray) {
    const [key, ...rest] = s.split('=');
    if (key && rest.length >= 0) {
      session[key] = rest.join('=');
    }
  }
  return session;
}

function handleError(action: string, err: unknown): never {
  console.error(`Failed to ${action}:`, err instanceof Error ? err.message : String(err));
  process.exit(1);
}

cronCmd
  .command('list')
  .description('Display existing cron jobs')
  .option('-c, --chat <id>', 'Specific chat to list cron jobs from')
  .action(async (options) => {
    try {
      const trpc = await getDaemonClient();
      const jobs = await trpc.listCronJobs.query({ chatId: options.chat });
      if (jobs.length === 0) {
        console.log('No cron jobs found.');
        return;
      }
      for (const job of jobs) {
        let schedule = '';
        if ('cron' in job.schedule) schedule = `cron: ${job.schedule.cron}`;
        else if ('every' in job.schedule) schedule = `every: ${job.schedule.every}`;
        else if ('at' in job.schedule) schedule = `at: ${job.schedule.at}`;

        console.log(`- ${job.id} (${schedule})`);
      }
    } catch (err) {
      handleError('list cron jobs', err);
    }
  });

cronCmd
  .command('add <name>')
  .description('Create a new cron job')
  .option('-m, --message <text>', 'The message to send', '')
  .option('-r, --reply <text>', 'An immediate reply to append')
  .option('--at <iso-time>', 'Execute once at this UTC time')
  .option('--every <duration>', 'Execute repeatedly at this interval (e.g., 20m, 4h)')
  .option('--cron <expression>', 'Execute according to the crontab expression')
  .option('-a, --agent <agentid>', 'Agent to use')
  .option(
    '-e, --env <env...>',
    'Environment variables in KEY=VALUE format (can be specified multiple times)'
  )
  .option('-s, --session <session...>', 'Session configuration in KEY=VALUE format (e.g. type=new)')
  .option('-c, --chat <chatid>', 'Specify the chat')
  .action(async (name, options) => {
    try {
      const schedules = [options.at, options.every, options.cron].filter(Boolean);
      if (schedules.length !== 1) {
        throw new Error('Exactly one of --at, --every, or --cron must be specified.');
      }

      let schedule: CronJob['schedule'];
      if (options.at) schedule = { at: options.at };
      else if (options.every) schedule = { every: options.every };
      else schedule = { cron: options.cron };

      const job: CronJob = {
        id: name,
        message: options.message,
        schedule,
      };

      if (options.reply) job.reply = options.reply;
      if (options.agent) job.agentId = options.agent;

      const env = parseEnv(options.env);
      if (env) job.env = env;

      const session = parseSession(options.session);
      if (session && session.type) {
        job.session = { type: session.type };
      }

      const trpc = await getDaemonClient();
      await trpc.addCronJob.mutate({ chatId: options.chat, job });
      console.log(`Cron job '${name}' created successfully.`);
    } catch (err) {
      handleError('create cron job', err);
    }
  });

cronCmd
  .command('delete <name>')
  .description('Remove a cron job')
  .option('-c, --chat <chatid>', 'Specify the chat')
  .action(async (name, options) => {
    try {
      const trpc = await getDaemonClient();
      const result = await trpc.deleteCronJob.mutate({ chatId: options.chat, id: name });
      if (result.deleted) {
        console.log(`Cron job '${name}' deleted successfully.`);
      } else {
        console.log(`Cron job '${name}' not found.`);
      }
    } catch (err) {
      handleError('delete cron job', err);
    }
  });
