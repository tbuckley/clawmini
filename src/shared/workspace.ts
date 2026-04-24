/* eslint-disable max-lines */
import { execSync } from 'node:child_process';
import {
  BUILTIN_POLICIES,
  type PolicyConfig,
  type PolicyConfigFile,
  type PolicyDefinition,
} from './policies.js';
import crypto from 'node:crypto';
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
  type Environment,
  EnvironmentSchema,
  type Settings,
  SettingsSchema,
} from './config.js';
import { pathIsInsideDir } from './utils/fs.js';
import {
  readTemplateManifest,
  planRefresh,
  applyPlan,
  walkTemplateFiles,
  writeInstalledFiles,
  readInstalledFiles,
  sliceInstalledUnder,
  prefixPlanKeys,
  type InstalledFiles,
  type RefreshPlan,
  type FileMode,
} from './template-manifest.js';

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
  let dirPath = workspaceRoot;
  if (customDir) {
    dirPath = path.resolve(workspaceRoot, customDir);
  } else if (agentId !== 'default') {
    dirPath = path.resolve(workspaceRoot, agentId);
  }

  if (!pathIsInsideDir(dirPath, workspaceRoot, { allowSameDir: true })) {
    throw new Error('Invalid agent directory: resolves outside the workspace.');
  }

  return dirPath;
}

// Returns null when the agent has explicitly opted out of skills via
// `"skillsDir": null` in its settings. Callers must handle null by
// skipping any skill-related install/refresh work.
export function resolveAgentSkillsDir(
  agentId: string,
  agentData: Agent,
  startDir = process.cwd()
): string | null {
  if (agentData.skillsDir === null) return null;
  const workDir = resolveAgentWorkDir(agentId, agentData.directory, startDir);
  return path.resolve(workDir, agentData.skillsDir || '.agents/skills');
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
  return path.join(getClawminiDir(startDir), 'daemon.sock');
}

export function getSettingsPath(startDir = process.cwd()): string {
  return path.join(getClawminiDir(startDir), 'settings.json');
}

export function getPoliciesPath(startDir = process.cwd()): string {
  return path.join(getClawminiDir(startDir), 'policies.json');
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

export function getInstalledFilesPath(agentId: string, startDir = process.cwd()): string {
  return path.join(getAgentDir(agentId, startDir), 'installed-files.json');
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
  // Atomic write: a plain writeFile truncates then writes, so a concurrent
  // reader can observe an empty file and throw `JSON.parse("")`. rename(2)
  // on the same filesystem is atomic, so readers always see old or new.
  const tmpPath = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fsPromises.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  await fsPromises.rename(tmpPath, filePath);
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

export const chatSettingsLocks = new Map<string, Promise<void>>();

export async function updateChatSettings(
  chatId: string,
  updater: (settings: ChatSettings) => ChatSettings | Promise<ChatSettings>,
  startDir = process.cwd()
): Promise<void> {
  const prevLock = chatSettingsLocks.get(chatId) || Promise.resolve();
  let release!: () => void;
  const nextLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  const nextLockPromise = prevLock.catch(() => {}).then(() => nextLock);
  chatSettingsLocks.set(chatId, nextLockPromise);

  try {
    await prevLock;
    const settings = (await readChatSettings(chatId, startDir)) || {};
    const updated = await updater(settings);
    await writeChatSettings(chatId, updated, startDir);
  } finally {
    release();
    if (chatSettingsLocks.get(chatId) === nextLockPromise) {
      chatSettingsLocks.delete(chatId);
    }
  }
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

// Reads only the on-disk overlay (local settings.json). Used when editing the
// overlay — callers that want the fully-resolved agent (template fields
// merged in) use `getAgent` instead.
export async function getAgentOverlay(
  agentId: string,
  startDir = process.cwd()
): Promise<Agent | null> {
  const filePath = getAgentSettingsPath(agentId, startDir);
  let dataStr: string;
  try {
    dataStr = await fsPromises.readFile(filePath, 'utf-8');
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') return null;
    throw err;
  }

  let data: unknown;
  try {
    data = JSON.parse(dataStr);
  } catch (parseErr: unknown) {
    const message = parseErr instanceof Error ? parseErr.message : String(parseErr);
    throw new Error(`Invalid JSON in ${filePath}: ${message}`, { cause: parseErr });
  }

  const parsed = AgentSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(`Invalid schema in ${filePath}: ${parsed.error.message}`);
  }
  return parsed.data;
}

async function readAgentTemplateSettings(
  templateName: string,
  startDir: string
): Promise<Agent | null> {
  let templatePath: string;
  try {
    templatePath = await resolveTemplatePath(templateName, startDir);
  } catch {
    return null;
  }
  const settingsPath = path.join(templatePath, 'settings.json');
  const data = await readJsonFile(settingsPath);
  if (!data) return null;
  const parsed = AgentSchema.safeParse(data);
  if (!parsed.success) return null;
  // `directory` in a template is never used — the overlay declares the work
  // directory instead. Strip it so it doesn't pollute the merge.
  const result = { ...parsed.data };
  delete result.directory;
  return result;
}

// Returns the fully-resolved agent: reads the local overlay, resolves any
// `extends` template, then shallow-merges the overlay over the template
// field-by-field. `env` and `subagentEnv` are deep-merged one level so the
// overlay can add one entry without dropping the template's defaults.
export async function getAgent(agentId: string, startDir = process.cwd()): Promise<Agent | null> {
  const overlay = await getAgentOverlay(agentId, startDir);
  if (!overlay) return null;
  if (!overlay.extends) return overlay;

  const template = await readAgentTemplateSettings(overlay.extends, startDir);
  if (!template) return overlay;

  const { env: overlayEnv, subagentEnv: overlaySub, ...overlayRest } = overlay;
  const { env: templateEnv, subagentEnv: templateSub, ...templateRest } = template;
  const merged: Agent = { ...templateRest, ...overlayRest };
  const mergedEnv = mergeOneLevel(templateEnv, overlayEnv);
  if (mergedEnv) merged.env = mergedEnv;
  const mergedSub = mergeOneLevel(templateSub, overlaySub);
  if (mergedSub) merged.subagentEnv = mergedSub;
  return merged;
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

export async function resolveTemplatePathBase(
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

export async function resolveTemplatePath(
  templateName: string,
  startDir = process.cwd()
): Promise<string> {
  if (templateName === 'environments' || templateName.startsWith('environments/')) {
    throw new Error(`Template not found: ${templateName}`);
  }
  return resolveTemplatePathBase(templateName, startDir);
}

export async function resolveEnvironmentTemplatePath(
  templateName: string,
  startDir = process.cwd()
): Promise<string> {
  return resolveTemplatePathBase(path.join('environments', templateName), startDir);
}

export async function resolveSkillsTemplatePath(startDir = process.cwd()): Promise<string> {
  return resolveTemplatePathBase('skills', startDir);
}

export async function copyTemplateBase(
  templatePath: string,
  targetDir: string,
  allowMissingDir: boolean = false,
  overwrite: boolean = false
): Promise<void> {
  // Check if target directory exists and is not empty
  try {
    const entries = await fsPromises.readdir(targetDir);
    if (entries.length > 0 && !overwrite) {
      throw new Error(`Target directory is not empty: ${targetDir}`);
    }
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
      if (allowMissingDir) {
        await fsPromises.mkdir(targetDir, { recursive: true });
      } else {
        throw new Error(`Target directory does not exist: ${targetDir}`, { cause: err });
      }
    } else {
      throw err;
    }
  }

  // Recursively copy. The template.json manifest is never copied — it's
  // metadata about how to handle the other files.
  const rootTemplateJson = path.resolve(templatePath, 'template.json');
  await fsPromises.cp(templatePath, targetDir, {
    recursive: true,
    force: true,
    filter: (src) => path.resolve(src) !== rootTemplateJson,
  });
}

export async function copyTemplate(
  templateName: string,
  targetDir: string,
  startDir = process.cwd(),
  opts: { force?: boolean } = {}
): Promise<void> {
  const templatePath = await resolveTemplatePath(templateName, startDir);
  await copyTemplateBase(templatePath, targetDir, false, opts.force ?? false);
}

export async function resolveTargetAgentSkillsDir(
  agentId: string,
  startDir = process.cwd()
): Promise<string | null> {
  const agentDir = getAgentDir(agentId, startDir);
  try {
    const stat = await fsPromises.stat(agentDir);
    if (!stat.isDirectory()) {
      throw new Error(`Agent not found: ${agentId}`);
    }
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
      throw new Error(`Agent not found: ${agentId}`, { cause: err });
    }
    throw err;
  }

  let agentData: Agent | null = null;
  try {
    agentData = await getAgent(agentId, startDir);
  } catch {
    // Ignore malformed settings.json
  }

  if (agentData) {
    return resolveAgentSkillsDir(agentId, agentData, startDir);
  }

  const workDir = resolveAgentWorkDir(agentId, undefined, startDir);
  return path.resolve(workDir, '.agents/skills');
}

export async function copyEnvironmentTemplate(
  templateName: string,
  targetDir: string,
  startDir = process.cwd()
): Promise<void> {
  const templatePath = await resolveEnvironmentTemplatePath(templateName, startDir);
  await copyTemplateBase(templatePath, targetDir, true);
}

export async function copyAgentSkills(
  agentId: string,
  startDir = process.cwd(),
  overwrite = false
): Promise<void> {
  const targetDir = await resolveTargetAgentSkillsDir(agentId, startDir);
  if (targetDir === null) {
    throw new Error(`Agent '${agentId}' has skills disabled (skillsDir is null).`);
  }
  const templatePath = await resolveSkillsTemplatePath(startDir);
  await copyTemplateBase(templatePath, targetDir, true, overwrite);
}

export async function copyAgentSkill(
  agentId: string,
  skillName: string,
  startDir = process.cwd(),
  overwrite = false
): Promise<void> {
  const targetDir = await resolveTargetAgentSkillsDir(agentId, startDir);
  if (targetDir === null) {
    throw new Error(`Agent '${agentId}' has skills disabled (skillsDir is null).`);
  }
  const templatePath = await resolveSkillsTemplatePath(startDir);
  const specificSkillPath = path.join(templatePath, skillName);

  try {
    const stat = await fsPromises.stat(specificSkillPath);
    if (!stat.isDirectory()) {
      throw new Error(`Skill not found: ${skillName}`);
    }
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
      throw new Error(`Skill not found: ${skillName}`, { cause: err });
    }
    throw err;
  }

  const skillTargetDir = path.join(targetDir, skillName);
  await copyTemplateBase(specificSkillPath, skillTargetDir, true, overwrite);
}

// Return the subset of template files that already exist in the target
// directory. Used to refuse a silent overwrite on first install.
async function collectTemplateCollisions(
  templateDir: string,
  targetDir: string
): Promise<string[]> {
  const templateFiles = await walkTemplateFiles(templateDir);
  const collisions: string[] = [];
  for (const rel of templateFiles) {
    try {
      await fsPromises.access(path.join(targetDir, rel));
      collisions.push(rel);
    } catch {
      // not present — no collision
    }
  }
  return collisions;
}

function formatCollisionError(collisions: string[]): string {
  const preview = collisions
    .slice(0, 5)
    .map((p) => `  ${p}`)
    .join('\n');
  const suffix = collisions.length > 5 ? `\n  ... and ${collisions.length - 5} more` : '';
  return `Target directory has existing files that the template would overwrite:\n${preview}${suffix}\nRe-run with --force to overwrite.`;
}

export async function applyTemplateToAgent(
  agentId: string,
  templateName: string,
  overrides: Agent,
  startDir = process.cwd(),
  opts: { fork?: boolean; force?: boolean } = {}
): Promise<void> {
  const agentWorkDir = resolveAgentWorkDir(agentId, overrides.directory, startDir);

  if (opts.fork) {
    // Legacy path: copy everything, merge template settings into the local
    // file, then strip the template metadata files from the workdir.
    await copyTemplate(templateName, agentWorkDir, startDir, { force: opts.force ?? false });

    const settingsPath = path.join(agentWorkDir, 'settings.json');
    const manifestPath = path.join(agentWorkDir, 'template.json');

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

        const mergedEnv = { ...(templateData.env || {}), ...(overrides.env || {}) };
        const mergedData: Agent = { ...templateData, ...overrides };
        delete mergedData.extends;
        if (Object.keys(mergedEnv).length > 0) mergedData.env = mergedEnv;

        await writeAgentSettings(agentId, mergedData, startDir);
      }
    } catch {
      // Ignore parsing or file not found errors
    }

    for (const tmp of [settingsPath, manifestPath]) {
      try {
        await fsPromises.rm(tmp);
      } catch {
        // Ignore if it doesn't exist
      }
    }
    return;
  }

  // Overlay mode: install files via the manifest, record SHAs, and write the
  // overlay pointing at the template. settings.json and template.json in the
  // template are metadata — neither gets copied.
  const templateDir = await resolveTemplatePath(templateName, startDir);
  const manifest = await readTemplateManifest(templateDir);
  await fsPromises.mkdir(agentWorkDir, { recursive: true });

  if (!opts.force) {
    const collisions = await collectTemplateCollisions(templateDir, agentWorkDir);
    if (collisions.length > 0) {
      throw new Error(formatCollisionError(collisions));
    }
  }

  const plan = await planRefresh(templateDir, agentWorkDir, manifest, null, {
    defaultMode: 'seed-once',
    firstInstall: true,
  });
  await applyPlan(templateDir, agentWorkDir, plan);
  await writeInstalledFiles(getInstalledFilesPath(agentId, startDir), plan.nextInstalled);

  const overlay: Agent = { extends: templateName, ...overrides };
  await writeAgentSettings(agentId, overlay, startDir);
}

// Refresh all `track` files in the agent's working directory against the
// template content. Diverged files are skipped unless `accept` is true.
// Returns the full plan so callers can report / dry-run as needed.
export async function refreshAgentTemplate(
  agentId: string,
  agent: Agent,
  startDir = process.cwd(),
  opts: { accept?: boolean; dryRun?: boolean } = {}
): Promise<RefreshPlan | null> {
  if (!agent.extends) return null;
  const templateDir = await resolveTemplatePath(agent.extends, startDir);
  const agentWorkDir = resolveAgentWorkDir(agentId, agent.directory, startDir);
  const manifest = await readTemplateManifest(templateDir);
  const installedPath = getInstalledFilesPath(agentId, startDir);
  const installed = await readInstalledFiles(installedPath);

  const plan = await planRefresh(templateDir, agentWorkDir, manifest, installed, {
    defaultMode: 'seed-once',
    ...(opts.accept === undefined ? {} : { accept: opts.accept }),
  });

  if (opts.dryRun) return plan;

  await applyPlan(templateDir, agentWorkDir, plan);
  await writeInstalledFiles(installedPath, plan.nextInstalled);
  return plan;
}

// Refresh the agent's template skills. Skills default to `track` for files
// unlisted in their manifest — the opposite of agent workdir files — because
// the authoring model differs: clawmini ships skill content, agents edit it.
// SHAs share the agent's installed-files.json keyed by the path relative to
// the agent's working directory (e.g. `.gemini/skills/skill-creator/SKILL.md`).
export async function refreshAgentSkills(
  agentId: string,
  agent: Agent,
  startDir = process.cwd(),
  opts: { accept?: boolean; dryRun?: boolean; firstInstall?: boolean } = {}
): Promise<RefreshPlan | null> {
  const skillsTargetDir = resolveAgentSkillsDir(agentId, agent, startDir);
  if (skillsTargetDir === null) return null;

  let skillsTemplateRoot: string;
  try {
    skillsTemplateRoot = await resolveSkillsTemplatePath(startDir);
  } catch {
    return null;
  }

  const agentWorkDir = resolveAgentWorkDir(agentId, agent.directory, startDir);
  const prefixRel = path.relative(agentWorkDir, skillsTargetDir).split(path.sep).join('/');

  let skillDirs: fs.Dirent[];
  try {
    skillDirs = await fsPromises.readdir(skillsTemplateRoot, { withFileTypes: true });
  } catch {
    return null;
  }

  const installedPath = getInstalledFilesPath(agentId, startDir);
  let installed = await readInstalledFiles(installedPath);
  const allActions: RefreshPlan['actions'] = [];

  for (const entry of skillDirs) {
    if (!entry.isDirectory()) continue;
    const skillName = entry.name;
    const skillTemplateDir = path.join(skillsTemplateRoot, skillName);
    const skillTargetDir = path.join(skillsTargetDir, skillName);
    const keyPrefix = `${prefixRel}/${skillName}`;

    const manifest = await readTemplateManifest(skillTemplateDir);
    const slice = sliceInstalledUnder(installed, keyPrefix);

    const plan = await planRefresh(skillTemplateDir, skillTargetDir, manifest, slice, {
      defaultMode: 'track',
      ...(opts.firstInstall ? { firstInstall: true } : {}),
      ...(opts.accept === undefined ? {} : { accept: opts.accept }),
    });

    const prefixed = prefixPlanKeys(plan, keyPrefix);
    allActions.push(...prefixed.actions);

    if (!opts.dryRun) {
      await applyPlan(skillTemplateDir, skillTargetDir, plan);
      installed = {
        files: {
          ...(installed?.files ?? {}),
          ...(prefixed.nextInstalled.files ?? {}),
        },
      };
    }
  }

  if (!opts.dryRun && installed) {
    await writeInstalledFiles(installedPath, installed);
  }

  return { actions: allActions, nextInstalled: installed ?? { files: {} } };
}

// Human-readable per-action lines for logging / dry-run. Prefixed with the
// agent id for readability when invoked over multiple agents at once.
export function formatPlanActions(
  plan: RefreshPlan,
  opts: { agentId?: string; prefix?: string } = {}
): string[] {
  const prefix = opts.prefix ?? (opts.agentId ? `[${opts.agentId}] ` : '');
  return plan.actions.map((action) => {
    switch (action.action) {
      case 'write':
        return `${prefix}${action.reason === 'new' ? 'install' : 'refresh'}  ${action.relPath}`;
      case 'skip-unchanged':
        return `${prefix}unchanged ${action.relPath}`;
      case 'skip-seed-once':
        return `${prefix}seed-once ${action.relPath}`;
      case 'skip-diverged':
        return `${prefix}diverged ${action.relPath} (${action.reason})`;
      case 'skip-absent-from-template':
        return `${prefix}absent   ${action.relPath}`;
    }
  });
}

export type { InstalledFiles, RefreshPlan, FileMode };

export async function readSettings(startDir = process.cwd()): Promise<Settings | null> {
  const data = await readJsonFile(getSettingsPath(startDir));
  if (!data) return null;
  const parsed = SettingsSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export async function writeSettings(data: Settings, startDir = process.cwd()): Promise<void> {
  await writeJsonFile(getSettingsPath(startDir), data as Record<string, unknown>);
}

export async function readPoliciesFile(startDir = process.cwd()): Promise<PolicyConfigFile | null> {
  const data = await readJsonFile(getPoliciesPath(startDir));
  if (!data) return null;
  if (data.policies && typeof data.policies === 'object') {
    return data as unknown as PolicyConfigFile;
  }
  return null;
}

// Merge built-ins, drop any user entries explicitly set to `false`. Pure: never
// mutates the input. A built-in is only injected when its installed script
// exists on disk, so the resolved config never advertises a command we know is
// missing. Relative `command` paths are resolved against the workspace root so
// the policy points at a real on-disk script regardless of the caller's cwd.
export function resolvePolicies(
  file: PolicyConfigFile | null,
  clawminiDir: string
): PolicyConfig | null {
  if (!file) return null;
  const workspaceRoot = path.dirname(clawminiDir);
  const resolveCommand = (definition: PolicyDefinition): PolicyDefinition => {
    if (!definition.command.startsWith('./') && !definition.command.startsWith('../')) {
      return definition;
    }
    return { ...definition, command: path.resolve(workspaceRoot, definition.command) };
  };

  const resolved: Record<string, PolicyDefinition> = {};
  for (const [name, value] of Object.entries(file.policies)) {
    if (value !== false) resolved[name] = resolveCommand(value);
  }
  for (const [name, definition] of Object.entries(BUILTIN_POLICIES)) {
    if (name in file.policies) continue;
    const scriptPath = path.join(clawminiDir, 'policy-scripts', `${name}.js`);
    if (!fs.existsSync(scriptPath)) continue;
    resolved[name] = resolveCommand(definition);
  }
  return { policies: resolved };
}

async function readBasePolicies(startDir = process.cwd()): Promise<PolicyConfig | null> {
  const file = await readPoliciesFile(startDir);
  return resolvePolicies(file, getClawminiDir(startDir));
}

// Resolves env-scoped policies for the active environment at `targetPath`.
// Relative `command` paths are resolved against the layered env search dirs
// (overlay first, then built-in template), so overlays can point at a
// built-in script without copying it.
export async function readEnvironmentPoliciesForPath(
  targetPath: string,
  startDir = process.cwd()
): Promise<Record<string, PolicyDefinition>> {
  const envInfo = await getActiveEnvironmentInfo(targetPath, startDir);
  if (!envInfo) return {};

  const envConfig = await readEnvironment(envInfo.name, startDir);
  if (!envConfig?.policies) return {};

  const searchDirs = await getEnvironmentSearchDirs(envInfo.name, startDir);
  const resolved: Record<string, PolicyDefinition> = {};
  for (const [name, definition] of Object.entries(envConfig.policies)) {
    const command =
      definition.command.startsWith('./') || definition.command.startsWith('../')
        ? resolveLayeredRelativePath(definition.command, searchDirs)
        : definition.command;
    const entries = Object.entries({ ...definition, command }).filter(
      ([, value]) => value !== undefined
    );
    resolved[name] = Object.fromEntries(entries) as unknown as PolicyDefinition;
  }
  return resolved;
}

export async function readPoliciesForPath(
  targetPath: string,
  startDir = process.cwd()
): Promise<PolicyConfig | null> {
  const base = await readBasePolicies(startDir);
  const envPolicies = await readEnvironmentPoliciesForPath(targetPath, startDir);
  if (Object.keys(envPolicies).length === 0) return base;
  return {
    policies: {
      ...(base?.policies || {}),
      ...envPolicies,
    },
  };
}

export function getEnvironmentPath(name: string, startDir = process.cwd()): string {
  return path.join(getClawminiDir(startDir), 'environments', name);
}

// Deep-merge one level of the nested value (used for env/policies). Local wins
// on conflict, missing keys flow through from the base.
function mergeOneLevel<T>(
  base: Record<string, T> | undefined,
  overlay: Record<string, T> | undefined
): Record<string, T> | undefined {
  if (!base && !overlay) return undefined;
  return { ...(base || {}), ...(overlay || {}) };
}

async function readEnvironmentRaw(name: string, startDir: string): Promise<Environment | null> {
  const localPath = path.join(getEnvironmentPath(name, startDir), 'env.json');
  const local = await readJsonFile(localPath);
  if (local) {
    const parsed = EnvironmentSchema.safeParse(local);
    if (parsed.success) return parsed.data;
  }

  // Parent references in `extends` resolve against built-in templates.
  try {
    const builtinDir = await resolveEnvironmentTemplatePath(name, startDir);
    const builtinData = await readJsonFile(path.join(builtinDir, 'env.json'));
    if (builtinData) {
      const parsed = EnvironmentSchema.safeParse(builtinData);
      if (parsed.success) return parsed.data;
    }
  } catch {
    // No built-in template with this name
  }

  return null;
}

async function readBuiltinEnvironment(name: string, startDir: string): Promise<Environment | null> {
  let builtinDir: string;
  try {
    builtinDir = await resolveEnvironmentTemplatePath(name, startDir);
  } catch {
    return null;
  }
  const data = await readJsonFile(path.join(builtinDir, 'env.json'));
  if (!data) return null;
  const parsed = EnvironmentSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

async function resolveEnvironmentWithSeen(
  name: string,
  startDir: string,
  seen: Set<string>
): Promise<Environment | null> {
  if (seen.has(name)) {
    throw new Error(`Environment extends cycle detected at '${name}'`);
  }
  seen.add(name);

  const local = await readEnvironmentRaw(name, startDir);
  if (!local || !local.extends) return local;

  // Self-extends (`.clawmini/environments/macos` with `extends: "macos"`)
  // pivots from the overlay layer down to the built-in template of the same
  // name. Without this branch, the recursion would hit `seen` and throw.
  const parent =
    local.extends === name
      ? await readBuiltinEnvironment(name, startDir)
      : await resolveEnvironmentWithSeen(local.extends, startDir, seen);
  if (!parent) return local;

  const { env: localEnv, policies: localPolicies, ...localRestRaw } = local;
  delete (localRestRaw as { extends?: string }).extends;
  const { env: parentEnv, policies: parentPolicies, ...parentRest } = parent;
  const merged: Environment = { ...parentRest, ...localRestRaw };
  const mergedEnv = mergeOneLevel(parentEnv, localEnv);
  if (mergedEnv) merged.env = mergedEnv;
  const mergedPolicies = mergeOneLevel(parentPolicies, localPolicies);
  if (mergedPolicies) merged.policies = mergedPolicies;
  return merged;
}

export async function readEnvironment(
  name: string,
  startDir = process.cwd()
): Promise<Environment | null> {
  return resolveEnvironmentWithSeen(name, startDir, new Set());
}

// The ordered list of directories an {ENV_DIR}-relative path should resolve
// against. The local overlay always comes first. If the overlay extends
// another environment, the parent's local overlay (if any) and the parent's
// built-in template dir are appended, walking up the chain. Consumers pick
// the first dir that actually contains the referenced file.
export async function getEnvironmentSearchDirs(
  name: string,
  startDir = process.cwd()
): Promise<string[]> {
  const dirs: string[] = [];
  const seen = new Set<string>();

  let currentName: string | undefined = name;
  while (currentName && !seen.has(currentName)) {
    seen.add(currentName);
    const overlayDir = getEnvironmentPath(currentName, startDir);
    if (fs.existsSync(overlayDir) && !dirs.includes(overlayDir)) dirs.push(overlayDir);

    let builtinDir: string | null = null;
    try {
      builtinDir = await resolveEnvironmentTemplatePath(currentName, startDir);
    } catch {
      // No built-in — overlay is self-contained
    }
    if (builtinDir && !dirs.includes(builtinDir)) dirs.push(builtinDir);

    const overlayEnvPath = path.join(overlayDir, 'env.json');
    const overlayData = await readJsonFile(overlayEnvPath);
    const overlayParsed = overlayData ? EnvironmentSchema.safeParse(overlayData) : null;
    if (overlayParsed?.success && overlayParsed.data.extends) {
      currentName = overlayParsed.data.extends;
      continue;
    }

    if (builtinDir) {
      const builtinEnvPath = path.join(builtinDir, 'env.json');
      const builtinData = await readJsonFile(builtinEnvPath);
      const builtinParsed = builtinData ? EnvironmentSchema.safeParse(builtinData) : null;
      if (builtinParsed?.success && builtinParsed.data.extends) {
        currentName = builtinParsed.data.extends;
        continue;
      }
    }

    currentName = undefined;
  }

  return dirs;
}

// Replace {ENV_DIR}[/subpath] occurrences with the first search dir that
// actually contains the subpath on disk. If no dir has it, the first search
// dir is used (so errors at exec time name a consistent location).
export function substituteLayeredEnvDir(input: string, searchDirs: string[]): string {
  if (searchDirs.length === 0) return input;
  return input.replace(/\{ENV_DIR\}(?:\/([^\s'"}]+))?/g, (_match, sub?: string) => {
    if (!sub) return searchDirs[0]!;
    for (const dir of searchDirs) {
      const candidate = path.resolve(dir, sub);
      if (fs.existsSync(candidate)) return candidate;
    }
    return path.resolve(searchDirs[0]!, sub);
  });
}

// Resolve a relative (`./foo` or `../foo`) policy/command path against the
// layered search dirs, preferring overlay first. Returns the first match; if
// none exists, returns the overlay-dir resolution for a stable error path.
export function resolveLayeredRelativePath(relPath: string, searchDirs: string[]): string {
  if (searchDirs.length === 0) return relPath;
  for (const dir of searchDirs) {
    const candidate = path.resolve(dir, relPath);
    if (fs.existsSync(candidate)) return candidate;
  }
  return path.resolve(searchDirs[0]!, relPath);
}

export async function getActiveEnvironmentInfo(
  targetPath: string,
  startDir = process.cwd()
): Promise<{ name: string; targetPath: string } | null> {
  const settings = await readSettings(startDir);
  if (!settings?.environments) return null;

  const workspaceRoot = getWorkspaceRoot(startDir);
  const resolvedTarget = path.resolve(workspaceRoot, targetPath);

  let bestMatch: { name: string; targetPath: string } | null = null;
  let maxDepth = -1;

  for (const [envPath, envName] of Object.entries(settings.environments)) {
    const resolvedEnvPath = path.resolve(workspaceRoot, envPath);

    if (pathIsInsideDir(resolvedTarget, resolvedEnvPath, { allowSameDir: true })) {
      const depth = resolvedEnvPath.split(path.sep).length;
      if (depth > maxDepth) {
        maxDepth = depth;
        bestMatch = { name: envName, targetPath: resolvedEnvPath };
      }
    }
  }

  return bestMatch;
}

export async function getActiveEnvironmentName(
  targetPath: string,
  startDir = process.cwd()
): Promise<string | null> {
  const info = await getActiveEnvironmentInfo(targetPath, startDir);
  return info ? info.name : null;
}

export async function enableEnvironment(
  name: string,
  targetPath: string = './',
  startDir = process.cwd(),
  opts: { fork?: boolean } = {}
): Promise<void> {
  const targetDir = getEnvironmentPath(name, startDir);

  // Default: write a minimal overlay (`{extends: name}`) pointing at the
  // built-in. Fork: clone the whole built-in template directory (legacy).
  if (!fs.existsSync(targetDir)) {
    if (opts.fork) {
      await copyEnvironmentTemplate(name, targetDir, startDir);
      console.log(`Forked environment template '${name}'.`);
    } else {
      // Require the built-in to exist so we don't write a dangling overlay.
      await resolveEnvironmentTemplatePath(name, startDir);
      await fsPromises.mkdir(targetDir, { recursive: true });
      await fsPromises.writeFile(
        path.join(targetDir, 'env.json'),
        JSON.stringify({ extends: name }, null, 2),
        'utf-8'
      );
      console.log(`Enabled environment overlay '${name}' (extends built-in).`);
    }
  } else {
    console.log(`Environment '${name}' already exists in workspace.`);
  }

  const settings = (await readSettings(startDir)) || { chats: { defaultId: '' } };
  const environments = settings.environments || {};

  environments[targetPath] = name;
  settings.environments = environments;

  await writeSettings(settings, startDir);
  console.log(`Enabled environment '${name}' for path '${targetPath}'.`);

  // Execute init command if present
  const envConfig = await readEnvironment(name, startDir);
  if (envConfig?.init) {
    // Get the target directory for the environment
    const workspaceRoot = getWorkspaceRoot(startDir);
    const affectedDir = path.resolve(workspaceRoot, targetPath);
    console.log(`Executing init command for environment '${name}': ${envConfig.init}`);
    execSync(envConfig.init, { cwd: affectedDir, stdio: 'inherit' });
  }
}
