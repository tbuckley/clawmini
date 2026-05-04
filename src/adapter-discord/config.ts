import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { getClawminiDir } from '../shared/workspace.js';
import fs from 'node:fs';

export const ThreadVisibilitySchema = z.object({
  threads: z.boolean().default(true),
  threadLog: z
    .object({
      maxToolPreview: z.number().default(400),
      maxLogMessageChars: z.number().default(1800),
      editDebounceMs: z.number().default(1000),
    })
    .optional(),
  // Proactive (cron) turns have no inbound user message. `silent` (default)
  // drops the cron system message; if the agent never produces a top-level
  // reply, the run is invisible. `header` posts a terse `🕐 <jobId>` top-
  // level message and threads the activity log on it, making scheduled work
  // visible even when the agent stays silent.
  jobs: z.enum(['silent', 'header']).default('silent').optional(),
});

export const DiscordConfigSchema = z.looseObject({
  botToken: z.string().min(1, 'Discord Bot Token is required.'),
  authorizedUserId: z.string().min(1, 'Authorized Discord User ID is required.'),
  chatId: z.string().default('default'),
  maxAttachmentSizeMB: z.number().default(25),
  requireMention: z.boolean().default(false),
  visibility: ThreadVisibilitySchema.optional(),
});

export type DiscordConfig = z.infer<typeof DiscordConfigSchema>;

export function getDiscordConfigPath(startDir = process.cwd()): string {
  return path.join(getClawminiDir(startDir), 'adapters', 'discord', 'config.json');
}

export async function readDiscordConfig(startDir = process.cwd()): Promise<DiscordConfig | null> {
  const configPath = getDiscordConfigPath(startDir);
  try {
    const data = await fsPromises.readFile(configPath, 'utf-8');
    const parsed = JSON.parse(data);
    return DiscordConfigSchema.parse(parsed);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

export async function initDiscordConfig(startDir = process.cwd()): Promise<void> {
  const configPath = getDiscordConfigPath(startDir);
  const configDir = path.dirname(configPath);

  await fsPromises.mkdir(configDir, { recursive: true });

  if (fs.existsSync(configPath)) {
    console.log(`Config file already exists at ${configPath}`);
    return;
  }

  const templateConfig = {
    botToken: 'YOUR_DISCORD_BOT_TOKEN',
    authorizedUserId: 'YOUR_DISCORD_USER_ID',
    chatId: 'default',
  };

  await fsPromises.writeFile(configPath, JSON.stringify(templateConfig, null, 2), 'utf-8');
  console.log(`Created template configuration file at ${configPath}`);
  console.log('Please update it with your actual Discord Bot Token and User ID.');
}

export function isAuthorized(userId: string, authorizedUserId: string): boolean {
  return userId === authorizedUserId;
}
