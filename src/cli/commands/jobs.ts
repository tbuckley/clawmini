import { Command } from 'commander';
import { getDaemonClient } from '../client.js';
import type { CronJob } from '../../shared/config.js';

export const jobsCmd = new Command('jobs').description('Manage background jobs');

function parseKeyValueArray(arr: string[] | undefined): Record<string, string> | undefined {
  if (!arr || arr.length === 0) return undefined;
  const result: Record<string, string> = {};
  for (const item of arr) {
    const [key, ...rest] = item.split('=');
    if (key && rest.length >= 0) {
      result[key] = rest.join('=');
    }
  }
  return result;
}

function handleError(action: string, err: unknown): never {
  console.error(`Failed to ${action}:`, err instanceof Error ? err.message : String(err));
  process.exit(1);
}

jobsCmd
  .command('list')
  .description('Display existing jobs')
  .option('-c, --chat <id>', 'Specific chat to list jobs from')
  .option('--json', 'Output full JSON for each job')
  .action(async (options) => {
    try {
      const trpc = await getDaemonClient();
      let jobs = await trpc.listCronJobs.query({ chatId: options.chat });

      jobs = jobs.sort((a, b) => {
        const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return timeA - timeB;
      });

      if (options.json) {
        console.log(JSON.stringify(jobs, null, 2));
        return;
      }

      if (jobs.length === 0) {
        console.log('No jobs found.');
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
      handleError('list jobs', err);
    }
  });

jobsCmd
  .command('add <name>')
  .description('Create a new job')
  .option('-m, --message <text>', 'The message to send', '')
  .option('-r, --reply <text>', 'An immediate reply to append')
  .option(
    '--at <time-or-interval>',
    'Execute once at this UTC time or after an interval (e.g., 2m, 4h)'
  )
  .option('--every <duration>', 'Execute repeatedly at this interval (e.g., 20m, 4h)')
  .option('--cron <expression>', 'Execute according to the crontab expression')
  .option('-a, --agent <agentid>', 'Agent to use')
  .option(
    '-e, --env <env...>',
    'Environment variables in KEY=VALUE format (can be specified multiple times)'
  )
  .option('-s, --session <type>', 'Session type (e.g. new)')
  .option('-c, --chat <chatid>', 'Specify the chat')
  .action(async (name, options) => {
    try {
      const schedules = [options.at, options.every, options.cron].filter(Boolean);
      if (schedules.length > 1) {
        throw new Error(
          'More than one schedule flag was set. Please use only one of --at, --every, or --cron.'
        );
      }
      if (schedules.length === 0) {
        throw new Error('A schedule must be specified (--at, --every, or --cron).');
      }

      let schedule: CronJob['schedule'];
      if (options.at) schedule = { at: options.at };
      else if (options.every) schedule = { every: options.every };
      else schedule = { cron: options.cron };

      const job: CronJob = {
        id: name,
        createdAt: new Date().toISOString(),
        message: options.message,
        schedule,
      };

      if (options.reply) job.reply = options.reply;
      if (options.agent) job.agentId = options.agent;

      const env = parseKeyValueArray(options.env);
      if (env) job.env = env;

      if (options.session) {
        if (options.session !== 'new') {
          throw new Error('Only the "new" session type is supported.');
        }
        job.session = { type: options.session };
      }

      const trpc = await getDaemonClient();
      await trpc.addCronJob.mutate({ chatId: options.chat, job });
      console.log(`Job '${name}' created successfully.`);
    } catch (err) {
      handleError('create job', err);
    }
  });

jobsCmd
  .command('delete <name>')
  .description('Remove a job')
  .option('-c, --chat <chatid>', 'Specify the chat')
  .action(async (name, options) => {
    try {
      const trpc = await getDaemonClient();
      const result = await trpc.deleteCronJob.mutate({ chatId: options.chat, id: name });
      if (result.deleted) {
        console.log(`Job '${name}' deleted successfully.`);
      } else {
        console.log(`Job '${name}' not found.`);
      }
    } catch (err) {
      handleError('delete job', err);
    }
  });
