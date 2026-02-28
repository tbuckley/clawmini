import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type Agent,
  AgentSchema,
  type ChatSettings,
  ChatSettingsSchema,
  type AgentSessionSettings,
  AgentSessionSettingsSchema,
} from './config.js';
import { pathIsInsideDir } from './utils/fs.js';

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

export function resolveAgentWorkDir(
  agentId: string,
  customDir?: string,
  startDir = process.cwd()
): string {
  const workspaceRoot = getWorkspaceRoot(startDir);
  const dirPath = customDir
    ? path.resolve(workspaceRoot, customDir)
    : path.resolve(workspaceRoot, agentId);

  if (!pathIsInsideDir(dirPath, workspaceRoot, { allowSameDir: true })) {
    throw new Error('Invalid agent directory: resolves outside the workspace.');
  }

  return dirPath;
}

export async function ensureAgentWorkDir(
  agentId: string,
  customDir?: string,
  startDir = process.cwd()
): Promise<string> {
  const dirPath = resolveAgentWorkDir(agentId, customDir, startDir);

  if (!fs.existsSync(dirPath)) {
    await fsPromises.mkdir(dirPath, { recursive: true });
    console.log(`Created agent working directory at ${dirPath}`);
  }
  return dirPath;
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
  return /^[a-zA-Z0-9_]+(?:-[a-zA-Z0-9_]+)*$/.test(agentId);
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
): Promise<ChatSettings | null> {
  const data = await readJsonFile(getChatSettingsPath(chatId, startDir));
  if (!data) return null;
  const parsed = ChatSettingsSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export async function writeChatSettings(
  chatId: string,
  data: ChatSettings,
  startDir = process.cwd()
): Promise<void> {
  await writeJsonFile(getChatSettingsPath(chatId, startDir), data as Record<string, unknown>);
}

export async function readAgentSessionSettings(
  agentId: string,
  sessionId: string,
  startDir = process.cwd()
): Promise<AgentSessionSettings | null> {
  const data = await readJsonFile(getAgentSessionSettingsPath(agentId, sessionId, startDir));
  if (!data) return null;
  const parsed = AgentSessionSettingsSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export async function writeAgentSessionSettings(
  agentId: string,
  sessionId: string,
  data: AgentSessionSettings,
  startDir = process.cwd()
): Promise<void> {
  await writeJsonFile(
    getAgentSessionSettingsPath(agentId, sessionId, startDir),
    data as Record<string, unknown>
  );
}

export async function getAgent(agentId: string, startDir = process.cwd()): Promise<Agent | null> {
  const data = await readJsonFile(getAgentSettingsPath(agentId, startDir));
  if (!data) return null;
  const parsed = AgentSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export async function writeAgentSettings(
  agentId: string,
  data: Agent,
  startDir = process.cwd()
): Promise<void> {
  await ensureAgentWorkDir(agentId, data.directory, startDir);
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
  const agentsDir = path.join(getClawminiDir(startDir), 'agents');

  if (!pathIsInsideDir(dir, agentsDir)) {
    throw new Error(`Security Error: Cannot delete agent directory outside of ${agentsDir}`);
  }

  try {
    await fsPromises.rm(dir, { recursive: true, force: true });
  } catch {
    // Ignore if not found
  }
}

async function isDirectory(dirPath: string): Promise<boolean> {
  try {
    const stat = await fsPromises.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

export async function resolveTemplatePath(
  templateName: string,
  startDir = process.cwd()
): Promise<string> {
  const workspaceRoot = getWorkspaceRoot(startDir);
  const localTemplatePath = path.join(workspaceRoot, '.clawmini', 'templates', templateName);

  if (await isDirectory(localTemplatePath)) {
    return localTemplatePath;
  }

  // Fallback to built-in templates
  // Find the clawmini package root by looking for package.json
  let currentDir = path.dirname(fileURLToPath(import.meta.url));
  while (
    currentDir !== path.parse(currentDir).root &&
    !fs.existsSync(path.join(currentDir, 'package.json'))
  ) {
    currentDir = path.dirname(currentDir);
  }

  const searchPath = path.join(currentDir, 'templates', templateName);

  if (await isDirectory(searchPath)) {
    return searchPath;
  }

  throw new Error(
    `Template not found: ${templateName} (searched local: ${localTemplatePath}, built-in: ${searchPath})`
  );
}

export async function copyTemplate(
  templateName: string,
  targetDir: string,
  startDir = process.cwd()
): Promise<void> {
  const templatePath = await resolveTemplatePath(templateName, startDir);

  // Check if target directory exists and is not empty
  try {
    const entries = await fsPromises.readdir(targetDir);
    if (entries.length > 0) {
      throw new Error(`Target directory is not empty: ${targetDir}`);
    }
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
      throw new Error(`Target directory does not exist: ${targetDir}`, { cause: err });
    }
    throw err;
  }

  // Recursively copy
  await fsPromises.cp(templatePath, targetDir, { recursive: true });
}

export async function applyTemplateToAgent(
  agentId: string,
  templateName: string,
  overrides: Agent,
  startDir = process.cwd()
): Promise<void> {
  const agentWorkDir = resolveAgentWorkDir(agentId, overrides.directory, startDir);
  await copyTemplate(templateName, agentWorkDir, startDir);

  const settingsPath = path.join(agentWorkDir, 'settings.json');
  try {
    const rawSettings = await fsPromises.readFile(settingsPath, 'utf-8');
    const parsedSettings = JSON.parse(rawSettings);
    const validation = AgentSchema.safeParse(parsedSettings);

    if (validation.success) {
      const templateData = validation.data;
      if (templateData.directory) {
        console.warn(
          `Warning: Ignoring 'directory' field from template settings.json. Using default or provided directory.`
        );
        delete templateData.directory;
      }

      // Merge: overrides take precedence over templateData
      const mergedEnv = { ...(templateData.env || {}), ...(overrides.env || {}) };
      const mergedData: Agent = { ...templateData, ...overrides };
      if (Object.keys(mergedEnv).length > 0) {
        mergedData.env = mergedEnv;
      }

      await writeAgentSettings(agentId, mergedData, startDir);
    }
  } catch {
    // Ignore parsing or file not found errors
  } finally {
    try {
      await fsPromises.rm(settingsPath);
    } catch {
      // Ignore if it doesn't exist
    }
  }
}
