import fs from 'node:fs/promises';
import path from 'node:path';
import { TRPCError } from '@trpc/server';
import { pathIsInsideDir } from '../../shared/utils/fs.js';
import {
  getAgent,
  getClawminiDir,
  readChatSettings,
  writeChatSettings,
} from '../../shared/workspace.js';
import { cronManager, normalizeJob } from '../cron.js';
import type { z } from 'zod';
import type { CronJobSchema } from '../../shared/config.js';

export async function getUniquePath(p: string): Promise<string> {
  let currentPath = p;
  let counter = 1;
  while (true) {
    try {
      await fs.stat(currentPath);
      const ext = path.extname(p);
      const base = path.basename(p, ext);
      currentPath = path.join(path.dirname(p), `${base}-${counter}${ext}`);
      counter++;
    } catch {
      return currentPath;
    }
  }
}

export async function resolveAgentDir(
  agentId: string | undefined | null,
  workspaceRoot: string
): Promise<string> {
  if (agentId && agentId !== 'default') {
    try {
      const agent = await getAgent(agentId, workspaceRoot);
      if (agent && agent.directory) {
        return path.resolve(workspaceRoot, agent.directory);
      }
    } catch (err: unknown) {
      console.warn(`Could not load custom agent '${agentId}' for resolving directory:`, err);
    }
    return path.resolve(workspaceRoot, agentId);
  }
  return workspaceRoot;
}

export async function getAgentFilesDir(
  agentId: string | undefined,
  chatId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  settings: any,
  workspaceRoot: string
): Promise<string> {
  const chatSettings = (await readChatSettings(chatId)) ?? {};
  const targetAgentId = agentId ?? chatSettings.defaultAgent ?? 'default';
  let agentFilesDir = settings?.defaultAgent?.files || './attachments';
  const agentDir = await resolveAgentDir(targetAgentId, workspaceRoot);

  if (targetAgentId !== 'default') {
    try {
      const customAgent = await getAgent(targetAgentId, workspaceRoot);
      if (customAgent?.files) {
        agentFilesDir = customAgent.files;
      }
    } catch (err: unknown) {
      console.warn(
        `Could not load custom agent '${targetAgentId}' for resolving files directory:`,
        err
      );
    }
  }

  return path.resolve(agentDir, agentFilesDir);
}

export async function validateAttachments(files: string[]): Promise<void> {
  const tmpDir = path.join(getClawminiDir(process.cwd()), 'tmp');

  for (const file of files) {
    const absoluteFile = path.resolve(process.cwd(), file);
    if (!pathIsInsideDir(absoluteFile, tmpDir)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'File must be inside the temporary directory.',
      });
    }
    try {
      await fs.access(absoluteFile);
    } catch {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `File does not exist: ${file}`,
      });
    }
  }
}

export async function validateLogFile(
  file: string,
  agentDir: string,
  workspaceRoot: string
): Promise<string> {
  const resolvedPath = path.resolve(agentDir, file);

  if (!pathIsInsideDir(resolvedPath, agentDir, { allowSameDir: true })) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'File must be within the agent workspace.',
    });
  }

  try {
    await fs.access(resolvedPath);
  } catch {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `File does not exist: ${file}`,
    });
  }

  return path.relative(workspaceRoot, resolvedPath);
}

export async function listCronJobsShared(chatId: string) {
  const settings = await readChatSettings(chatId);
  return settings?.jobs ?? [];
}

export async function addCronJobShared(chatId: string, job: z.infer<typeof CronJobSchema>) {
  const normalized = normalizeJob(job);
  const settings = (await readChatSettings(chatId)) || {};
  const cronJobs = settings.jobs ?? [];
  const existingIndex = cronJobs.findIndex((j) => j.id === normalized.id);
  if (existingIndex >= 0) {
    cronJobs[existingIndex] = normalized;
  } else {
    cronJobs.push(normalized);
  }
  settings.jobs = cronJobs;
  await writeChatSettings(chatId, settings);
  cronManager.scheduleJob(chatId, normalized);
  return { success: true };
}

export async function deleteCronJobShared(chatId: string, id: string) {
  const settings = await readChatSettings(chatId);
  if (!settings || !settings.jobs) {
    return { success: true, deleted: false };
  }
  const initialLength = settings.jobs.length;
  settings.jobs = settings.jobs.filter((j) => j.id !== id);
  if (settings.jobs.length !== initialLength) {
    await writeChatSettings(chatId, settings);
    cronManager.unscheduleJob(chatId, id);
    return { success: true, deleted: true };
  }
  return { success: true, deleted: false };
}
