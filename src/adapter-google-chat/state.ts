import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { getClawminiDir } from '../shared/workspace.js';

export const GoogleChatStateSchema = z.object({
  lastSyncedMessageId: z.string().optional(),
  lastDriveCleanupMs: z.number().optional(),
  driveOauthTokens: z.any().optional(),
});

export type GoogleChatState = z.infer<typeof GoogleChatStateSchema>;

export function getGoogleChatStatePath(startDir = process.cwd()): string {
  return path.join(getClawminiDir(startDir), 'adapters', 'google-chat', 'state.json');
}

export async function readGoogleChatState(startDir = process.cwd()): Promise<GoogleChatState> {
  const statePath = getGoogleChatStatePath(startDir);
  try {
    const data = await fsPromises.readFile(statePath, 'utf-8');
    const parsed = JSON.parse(data);
    const result = GoogleChatStateSchema.safeParse(parsed);
    if (!result.success) {
      return {
        lastSyncedMessageId: undefined,
        lastDriveCleanupMs: undefined,
        driveOauthTokens: undefined,
      };
    }
    return result.data;
  } catch {
    // Return default state if file doesn't exist or is invalid JSON
    return {
      lastSyncedMessageId: undefined,
      lastDriveCleanupMs: undefined,
      driveOauthTokens: undefined,
    };
  }
}

export async function updateGoogleChatState(
  updates: Partial<GoogleChatState>,
  startDir = process.cwd()
): Promise<GoogleChatState> {
  const currentState = await readGoogleChatState(startDir);
  const newState = { ...currentState, ...updates };
  const statePath = getGoogleChatStatePath(startDir);
  const dir = path.dirname(statePath);
  try {
    await fsPromises.mkdir(dir, { recursive: true });
    await fsPromises.writeFile(statePath, JSON.stringify(newState, null, 2), 'utf-8');
  } catch (err) {
    console.error(`Failed to write Google Chat state to ${statePath}:`, err);
  }
  return newState;
}
