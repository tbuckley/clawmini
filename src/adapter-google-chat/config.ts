import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { getClawminiDir } from '../shared/workspace.js';
import fs from 'node:fs';

export const GoogleChatConfigSchema = z.looseObject({
  pubsubSubscriptionName: z.string().min(1, 'Pub/Sub Subscription Name is required.'),
  authorizedUsers: z.array(z.string()).min(1, 'At least one Authorized User is required.'),
  defaultChatId: z.string().default('default'),
  maxAttachmentSizeMB: z.number().default(25).optional(),
});

export type GoogleChatConfig = z.infer<typeof GoogleChatConfigSchema>;

export function getGoogleChatConfigPath(startDir = process.cwd()): string {
  return path.join(getClawminiDir(startDir), 'adapters', 'google-chat', 'config.json');
}

export async function readGoogleChatConfig(
  startDir = process.cwd()
): Promise<GoogleChatConfig | null> {
  const configPath = getGoogleChatConfigPath(startDir);
  try {
    const data = await fsPromises.readFile(configPath, 'utf-8');
    const parsed = JSON.parse(data);
    const result = GoogleChatConfigSchema.safeParse(parsed);
    if (!result.success) {
      console.error('Invalid Google Chat configuration:', result.error.format());
      return null;
    }
    return result.data;
  } catch {
    // Return null if file doesn't exist or is invalid JSON
    return null;
  }
}

export async function initGoogleChatConfig(startDir = process.cwd()): Promise<void> {
  const configPath = getGoogleChatConfigPath(startDir);
  const configDir = path.dirname(configPath);

  await fsPromises.mkdir(configDir, { recursive: true });

  if (fs.existsSync(configPath)) {
    console.log(`Config file already exists at ${configPath}`);
    return;
  }

  const templateConfig = {
    pubsubSubscriptionName: 'projects/YOUR_PROJECT_ID/subscriptions/YOUR_SUBSCRIPTION_NAME',
    authorizedUsers: ['user@example.com'],
    defaultChatId: 'default',
  };

  await fsPromises.writeFile(configPath, JSON.stringify(templateConfig, null, 2), 'utf-8');
  console.log(`Created template configuration file at ${configPath}`);
  console.log('Please update it with your actual Pub/Sub Subscription Name and Authorized Users.');
}

export function isAuthorized(userIdOrEmail: string, authorizedUsers: string[]): boolean {
  return authorizedUsers.includes(userIdOrEmail);
}
