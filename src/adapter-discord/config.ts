import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { getClawminiDir } from '../shared/workspace.js';
import fs from 'node:fs';

export const DiscordConfigSchema = z.looseObject({
  botToken: z.string().min(1, 'Discord Bot Token is required.'),
  authorizedUserId: z.string().min(1, 'Authorized Discord User ID is required.'),
  chatId: z.string().default('default'),
  maxAttachmentSizeMB: z.number().default(25).optional(),
  messages: z.record(z.string(), z.boolean()).optional(),
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
    const result = DiscordConfigSchema.safeParse(parsed);
    if (!result.success) {
      console.error('Invalid Discord configuration:', result.error.format());
      return null;
    }
    return result.data;
  } catch {
    // Return null if file doesn't exist or is invalid JSON
    return null;
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
