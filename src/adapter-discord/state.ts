import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { getClawminiDir } from '../shared/workspace.js';

export const DiscordStateSchema = z.object({
  lastSyncedMessageIds: z.record(z.string(), z.string()).optional(),
  channelChatMap: z.record(z.string(), z.string()).optional(),
  filters: z.record(z.string(), z.boolean()).optional(),
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

    // Migrate legacy state
    if (parsed.lastSyncedMessageId && !parsed.lastSyncedMessageIds) {
      parsed.lastSyncedMessageIds = { default: parsed.lastSyncedMessageId };
    }

    const result = DiscordStateSchema.safeParse(parsed);
    if (!result.success) {
      return {};
    }
    return result.data;
  } catch {
    // Return default state if file doesn't exist or is invalid JSON
    return {};
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

let stateUpdatePromise = Promise.resolve();

export function updateDiscordState(
  updates: Partial<DiscordState> | ((state: DiscordState) => Partial<DiscordState>),
  startDir = process.cwd()
): Promise<DiscordState> {
  return new Promise((resolve, reject) => {
    stateUpdatePromise = stateUpdatePromise.then(async () => {
      try {
        const currentState = await readDiscordState(startDir);
        const resolvedUpdates = typeof updates === 'function' ? updates(currentState) : updates;
        const newState = { ...currentState, ...resolvedUpdates };
        await writeDiscordState(newState, startDir);
        resolve(newState);
      } catch (err) {
        console.error(`Failed to write Discord state:`, err);
        reject(err);
      }
    });
  });
}
