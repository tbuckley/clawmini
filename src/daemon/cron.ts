// @ts-expect-error - node-schedule types are missing
import schedule from 'node-schedule';
import { listChats } from '../shared/chats.js';
import { readChatSettings, writeChatSettings } from '../shared/workspace.js';
import { executeDirectMessage, type RunCommandFn } from './message.js';
import type { CronJob, Settings } from '../shared/config.js';
import fs from 'node:fs/promises';
import { getSettingsPath } from '../shared/workspace.js';
import { spawn } from 'node:child_process';

export const cronRunCommand: RunCommandFn = async ({ command, cwd, env, stdin }) => {
  return new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve) => {
    const p = spawn(command, { shell: true, cwd, env });
    if (stdin && p.stdin) {
      p.stdin.on('error', () => {}); // Ignore pipe errors
      p.stdin.write(stdin);
      p.stdin.end();
    }
    let stdout = '';
    let stderr = '';
    if (p.stdout) {
      p.stdout.on('data', (data) => (stdout += data.toString()));
    }
    if (p.stderr) {
      p.stderr.on('data', (data) => (stderr += data.toString()));
    }
    p.on('close', (code) => resolve({ stdout, stderr, exitCode: code ?? 1 }));
    p.on('error', (err) => resolve({ stdout: '', stderr: err.toString(), exitCode: 1 }));
  });
};

export class CronManager {
  private jobs = new Map<string, schedule.Job>();

  private getJobKey(chatId: string, jobId: string) {
    return `${chatId}::${jobId}`;
  }

  async init() {
    const chats = await listChats();
    for (const chatId of chats) {
      const settings = await readChatSettings(chatId);
      if (settings?.cronJobs) {
        for (const job of settings.cronJobs) {
          this.scheduleJob(chatId, job);
        }
      }
    }
  }

  scheduleJob(chatId: string, job: CronJob) {
    this.unscheduleJob(chatId, job.id);

    let rule: string | Date;
    let isOneOff = false;

    if ('cron' in job.schedule) {
      rule = (job.schedule as { cron: string }).cron;
    } else if ('every' in job.schedule) {
      const everyStr = (job.schedule as { every: string }).every;
      const match = everyStr.match(/^(\d+)\s*(m|min|minutes?|h|hours?|d|days?)$/i);
      if (match) {
        const val = parseInt(match[1]!, 10);
        const unit = match[2]!.toLowerCase();
        if (unit.startsWith('m')) {
          rule = `*/${val} * * * *`;
        } else if (unit.startsWith('h')) {
          rule = `0 */${val} * * *`;
        } else if (unit.startsWith('d')) {
          rule = `0 0 */${val} * *`;
        } else {
          rule = everyStr;
        }
      } else {
        rule = everyStr;
      }
    } else if ('at' in job.schedule) {
      rule = new Date((job.schedule as { at: string }).at);
      isOneOff = true;
    } else {
      console.warn(`Unknown schedule format for job ${job.id}`);
      return;
    }

    try {
      const scheduledJob = schedule.scheduleJob(rule, async () => {
        await this.executeJob(chatId, job, isOneOff);
      });
      if (scheduledJob) {
        this.jobs.set(this.getJobKey(chatId, job.id), scheduledJob);
      }
    } catch (err) {
      console.error(`Failed to schedule job ${job.id} for chat ${chatId}:`, err);
    }
  }

  unscheduleJob(chatId: string, jobId: string) {
    const key = this.getJobKey(chatId, jobId);
    const job = this.jobs.get(key);
    if (job) {
      job.cancel();
      this.jobs.delete(key);
    }
  }

  private async executeJob(chatId: string, job: CronJob, isOneOff: boolean) {
    try {
      const settingsPath = getSettingsPath();
      let globalSettings: Settings | undefined;
      try {
        const settingsStr = await fs.readFile(settingsPath, 'utf8');
        globalSettings = JSON.parse(settingsStr) as Settings;
      } catch {
        globalSettings = undefined;
      }

      let sessionId = undefined;
      if (job.session?.type === 'new') {
        sessionId = crypto.randomUUID();
      }

      const routerState: import('./routers/types.js').RouterState = {
        message: job.message,
        chatId: chatId,
      };
      if (job.agentId !== undefined) routerState.agentId = job.agentId;
      if (sessionId !== undefined) routerState.sessionId = sessionId;
      if (job.env !== undefined) routerState.env = job.env;
      if (job.reply !== undefined) routerState.reply = job.reply;

      await executeDirectMessage(
        chatId,
        routerState,
        globalSettings,
        process.cwd(),
        cronRunCommand,
        false,
        job.message
      );

      if (isOneOff) {
        const chatSettings = await readChatSettings(chatId);
        if (chatSettings && chatSettings.cronJobs) {
          chatSettings.cronJobs = chatSettings.cronJobs.filter((j) => j.id !== job.id);
          await writeChatSettings(chatId, chatSettings);
        }
        this.unscheduleJob(chatId, job.id);
      }
    } catch (err) {
      console.error(`Error executing cron job ${job.id} for chat ${chatId}:`, err);
    }
  }
}

export const cronManager = new CronManager();
