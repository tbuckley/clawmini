import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { getClawminiDir } from '../shared/workspace.js';

export const DiscordConfigSchema = z.looseObject({
  botToken: z.string().min(1, 'Discord Bot Token is required.'),
  authorizedUserId: z.string().min(1, 'Authorized Discord User ID is required.'),
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

export function isAuthorized(userId: string, authorizedUserId: string): boolean {
  return userId === authorizedUserId;
}
