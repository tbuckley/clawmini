import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { getClawminiDir } from '../shared/workspace.js';

export const GoogleChatStateSchema = z.object({
  lastSyncedMessageIds: z.record(z.string(), z.string()).optional(),
  channelChatMap: z
    .record(
      z.string(),
      z.object({
        chatId: z.string().nullable().optional(),
        subscriptionId: z.string().optional(),
        expirationDate: z.string().optional(),
        requireMention: z.boolean().optional(),
        threadsDisabled: z.boolean().optional(),
      })
    )
    .optional(),
  oauthTokens: z.any().optional(),
  filters: z.record(z.string(), z.boolean()).optional(),
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

    // Migrate legacy state
    if (parsed.lastSyncedMessageId && !parsed.lastSyncedMessageIds) {
      parsed.lastSyncedMessageIds = { default: parsed.lastSyncedMessageId };
    }
    if (parsed.driveOauthTokens && !parsed.oauthTokens) {
      parsed.oauthTokens = parsed.driveOauthTokens;
      delete parsed.driveOauthTokens;
    }
    if (parsed.channelChatMap) {
      for (const [key, value] of Object.entries(parsed.channelChatMap)) {
        if (typeof value === 'string') {
          parsed.channelChatMap[key] = { chatId: value };
        }
      }
    }

    return GoogleChatStateSchema.parse(parsed);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        oauthTokens: undefined,
      };
    }
    throw err;
  }
}

let stateUpdatePromise = Promise.resolve();

export function updateGoogleChatState(
  updates: Partial<GoogleChatState> | ((state: GoogleChatState) => Partial<GoogleChatState>),
  startDir = process.cwd()
): Promise<GoogleChatState> {
  return new Promise((resolve, reject) => {
    stateUpdatePromise = stateUpdatePromise.then(async () => {
      try {
        const currentState = await readGoogleChatState(startDir);
        const resolvedUpdates = typeof updates === 'function' ? updates(currentState) : updates;
        const newState = { ...currentState, ...resolvedUpdates };
        const statePath = getGoogleChatStatePath(startDir);
        const dir = path.dirname(statePath);
        await fsPromises.mkdir(dir, { recursive: true });
        await fsPromises.writeFile(statePath, JSON.stringify(newState, null, 2), 'utf-8');
        resolve(newState);
      } catch (err) {
        console.error(`Failed to write Google Chat state:`, err);
        reject(err);
      }
    });
  });
}
