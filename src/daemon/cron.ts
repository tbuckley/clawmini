// @ts-expect-error - node-schedule types are missing
import schedule from 'node-schedule';
import { listChats } from '../shared/chats.js';
import { readChatSettings, writeChatSettings } from '../shared/workspace.js';
import { executeDirectMessage, getInitialRouterState, applyRouterStateUpdates } from './message.js';
import { executeRouterPipeline, resolveRouters } from './routers.js';
import type { CronJob, Settings } from '../shared/config.js';
import fs from 'node:fs/promises';
import { getSettingsPath } from '../shared/workspace.js';
import { applyEnvOverrides } from '../shared/utils/env.js';

// Resolves relative `at` intervals (e.g. "2s", "5m") to absolute ISO timestamps
// so a job's target time is stable across daemon restarts. Throws on unparseable
// `at` values so invalid input is rejected at creation rather than silently
// shifted by `scheduleJob`. `cron` and `every` schedules pass through unchanged.
export function normalizeJob(job: CronJob): CronJob {
  if (!('at' in job.schedule)) return job;

  const atStr = job.schedule.at;
  const match = atStr.match(/^(\d+)\s*(m|min|minutes?|h|hours?|d|days?|s|sec|seconds?)$/i);
  let absolute: Date;
  if (match) {
    const val = parseInt(match[1]!, 10);
    const unit = match[2]!.toLowerCase();
    let ms = 0;
    if (unit.startsWith('s')) ms = val * 1000;
    else if (unit.startsWith('m')) ms = val * 60 * 1000;
    else if (unit.startsWith('h')) ms = val * 60 * 60 * 1000;
    else if (unit.startsWith('d')) ms = val * 24 * 60 * 60 * 1000;
    absolute = new Date(Date.now() + ms);
  } else {
    absolute = new Date(atStr);
    if (isNaN(absolute.getTime())) {
      throw new Error(`Invalid date format for 'at' schedule: ${atStr}`);
    }
  }
  return { ...job, schedule: { at: absolute.toISOString() } };
}

export class CronManager {
  private jobs = new Map<string, schedule.Job>();

  private getJobKey(chatId: string, jobId: string) {
    return `${chatId}::${jobId}`;
  }

  async init() {
    const chats = await listChats();
    for (const chatId of chats) {
      const settings = await readChatSettings(chatId);
      if (settings?.jobs) {
        for (const job of settings.jobs) {
          try {
            this.scheduleJob(chatId, job);
          } catch (err) {
            console.error(
              `Failed to initialize job ${job.id} for chat ${chatId}:`,
              err instanceof Error ? err.message : err
            );
          }
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
      const atStr = job.schedule.at;
      rule = new Date(atStr);
      if (isNaN(rule.getTime())) {
        throw new Error(`Invalid date format for 'at' schedule: ${atStr}`);
      }
      // If the target time has already passed (e.g. daemon was down past it),
      // node-schedule returns null and the job silently never fires. Push it
      // just into the future so it executes on the next tick and cleans up.
      if (rule.getTime() <= Date.now()) {
        console.warn(
          `One-off job ${job.id} for chat ${chatId} is overdue (target ${atStr}); firing immediately.`
        );
        rule = new Date(Date.now() + 100);
      }
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

      const overrideSessionId = job.session?.type === 'new' ? crypto.randomUUID() : job.session?.id;
      const chatSettings = (await readChatSettings(chatId, process.cwd())) ?? {};
      let routerState = await getInitialRouterState(
        chatId,
        job.message,
        chatSettings,
        job.agentId,
        overrideSessionId
      );

      if (job.env !== undefined) {
        routerState.env = routerState.env || {};
        applyEnvOverrides(routerState.env, job.env);
      }

      const currentAgentId = job.agentId ?? chatSettings.defaultAgent ?? 'default';
      const currentActiveSession = chatSettings.sessions?.[currentAgentId];
      const isOutdatedSession =
        job.session?.type === 'existing' &&
        currentActiveSession !== undefined &&
        currentActiveSession !== job.session.id;

      if (job.reply !== undefined && !isOutdatedSession) routerState.reply = job.reply;
      if (job.nextSessionId !== undefined && !isOutdatedSession)
        routerState.nextSessionId = job.nextSessionId;
      if (job.action !== undefined) routerState.action = job.action;
      if (job.jobs !== undefined) routerState.jobs = job.jobs;

      const routers = chatSettings.routers ?? globalSettings?.routers ?? [];
      const resolvedRouters = resolveRouters(routers, false);
      const initialState = { ...routerState };
      routerState = await executeRouterPipeline(routerState, resolvedRouters);

      await applyRouterStateUpdates(
        chatId,
        process.cwd(),
        routerState,
        chatSettings,
        initialState.agentId
      );

      await executeDirectMessage(
        chatId,
        routerState,
        globalSettings,
        process.cwd(),
        false,
        job.message,
        undefined,
        'cron'
      );

      if (isOneOff) {
        const chatSettings = await readChatSettings(chatId);
        if (chatSettings && chatSettings.jobs) {
          chatSettings.jobs = chatSettings.jobs.filter((j) => j.id !== job.id);
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
