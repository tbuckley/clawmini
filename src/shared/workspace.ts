import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import type { Agent } from './config.js';

export function getWorkspaceRoot(startDir = process.cwd()): string {
  let curr = startDir;
  while (curr !== path.parse(curr).root) {
    if (fs.existsSync(path.join(curr, '.clawmini'))) {
      return curr;
    }
    if (fs.existsSync(path.join(curr, 'package.json')) || fs.existsSync(path.join(curr, '.git'))) {
      return curr;
    }
    curr = path.dirname(curr);
  }
  return startDir;
}

export function getClawminiDir(startDir = process.cwd()): string {
  return path.join(getWorkspaceRoot(startDir), '.clawmini');
}

export function getSocketPath(startDir = process.cwd()): string {
  return path.join(getClawminiDir(startDir), 'server.sock');
}

export function getSettingsPath(startDir = process.cwd()): string {
  return path.join(getClawminiDir(startDir), 'settings.json');
}

export function getChatSettingsPath(chatId: string, startDir = process.cwd()): string {
  return path.join(getClawminiDir(startDir), 'chats', chatId, 'settings.json');
}

export function isValidAgentId(agentId: string): boolean {
  if (!agentId || agentId.length === 0) return false;
  if (agentId.includes('/') || agentId.includes('\\') || agentId.includes('..')) return false;
  return true;
}

export function getAgentDir(agentId: string, startDir = process.cwd()): string {
  if (!isValidAgentId(agentId)) {
    throw new Error(`Invalid agent ID: ${agentId}`);
  }
  return path.join(getClawminiDir(startDir), 'agents', agentId);
}

export function getAgentSettingsPath(agentId: string, startDir = process.cwd()): string {
  return path.join(getAgentDir(agentId, startDir), 'settings.json');
}

export function getAgentSessionSettingsPath(
  agentId: string,
  sessionId: string,
  startDir = process.cwd()
): string {
  if (!isValidAgentId(agentId)) {
    throw new Error(`Invalid agent ID: ${agentId}`);
  }
  return path.join(
    getClawminiDir(startDir),
    'agents',
    agentId,
    'sessions',
    sessionId,
    'settings.json'
  );
}

async function readJsonFile(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const data = await fsPromises.readFile(filePath, 'utf-8');
    return JSON.parse(data) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function writeJsonFile(filePath: string, data: Record<string, unknown>): Promise<void> {
  const dir = path.dirname(filePath);
  await fsPromises.mkdir(dir, { recursive: true });
  await fsPromises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

export async function readChatSettings(
  chatId: string,
  startDir = process.cwd()
): Promise<Record<string, unknown> | null> {
  return readJsonFile(getChatSettingsPath(chatId, startDir));
}

export async function writeChatSettings(
  chatId: string,
  data: Record<string, unknown>,
  startDir = process.cwd()
): Promise<void> {
  await writeJsonFile(getChatSettingsPath(chatId, startDir), data);
}

export async function readAgentSessionSettings(
  agentId: string,
  sessionId: string,
  startDir = process.cwd()
): Promise<Record<string, unknown> | null> {
  return readJsonFile(getAgentSessionSettingsPath(agentId, sessionId, startDir));
}

export async function writeAgentSessionSettings(
  agentId: string,
  sessionId: string,
  data: Record<string, unknown>,
  startDir = process.cwd()
): Promise<void> {
  await writeJsonFile(getAgentSessionSettingsPath(agentId, sessionId, startDir), data);
}

export async function getAgent(agentId: string, startDir = process.cwd()): Promise<Agent | null> {
  const data = await readJsonFile(getAgentSettingsPath(agentId, startDir));
  if (!data) return null;
  return data as Agent;
}

export async function writeAgentSettings(
  agentId: string,
  data: Agent,
  startDir = process.cwd()
): Promise<void> {
  await writeJsonFile(getAgentSettingsPath(agentId, startDir), data as Record<string, unknown>);
}

export async function listAgents(startDir = process.cwd()): Promise<string[]> {
  const agentsDir = path.join(getClawminiDir(startDir), 'agents');
  try {
    const entries = await fsPromises.readdir(agentsDir, { withFileTypes: true });
    const agentIds = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const settingsPath = path.join(agentsDir, entry.name, 'settings.json');
        try {
          await fsPromises.access(settingsPath);
          agentIds.push(entry.name);
        } catch {
          // No settings.json, probably just a sessions dir for a non-existent agent or default agent
        }
      }
    }
    return agentIds;
  } catch {
    return [];
  }
}

export async function deleteAgent(agentId: string, startDir = process.cwd()): Promise<void> {
  const dir = getAgentDir(agentId, startDir);
  try {
    await fsPromises.rm(dir, { recursive: true, force: true });
  } catch {
    // Ignore if not found
  }
}
