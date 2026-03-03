import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { getClawminiDir } from '../shared/workspace.js';

export const DiscordStateSchema = z.object({
  lastSyncedMessageId: z.string().optional(),
});

export type DiscordState = z.infer<typeof DiscordStateSchema>;

export function getDiscordStatePath(startDir = process.cwd()): string {
  return path.join(getClawminiDir(startDir), 'adapters', 'discord', 'state.json');
}

export async function readDiscordState(startDir = process.cwd()): Promise<DiscordState> {
  const statePath = getDiscordStatePath(startDir);
  try {
    const data = await fsPromises.readFile(statePath, 'utf-8');
    const parsed = JSON.parse(data);
    const result = DiscordStateSchema.safeParse(parsed);
    if (!result.success) {
      return { lastSyncedMessageId: undefined };
    }
    return result.data;
  } catch {
    // Return default state if file doesn't exist or is invalid JSON
    return { lastSyncedMessageId: undefined };
  }
}

export async function writeDiscordState(
  state: DiscordState,
  startDir = process.cwd()
): Promise<void> {
  const statePath = getDiscordStatePath(startDir);
  const dir = path.dirname(statePath);
  try {
    await fsPromises.mkdir(dir, { recursive: true });
    await fsPromises.writeFile(statePath, JSON.stringify(state, null, 2), 'utf-8');
  } catch (err) {
    console.error(`Failed to write Discord state to ${statePath}:`, err);
  }
}
