import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';

export type FileMode = 'track' | 'seed-once';

const TemplateManifestSchema = z.looseObject({
  files: z.record(z.string(), z.enum(['track', 'seed-once'])).optional(),
});

export type TemplateManifest = z.infer<typeof TemplateManifestSchema>;

const InstalledFilesSchema = z.looseObject({
  files: z
    .record(
      z.string(),
      z.looseObject({
        sha: z.string(),
      })
    )
    .optional(),
});

export type InstalledFiles = z.infer<typeof InstalledFilesSchema>;

export function sha256(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

export async function fileSha(filePath: string): Promise<string | null> {
  try {
    const buf = await fsPromises.readFile(filePath);
    return sha256(buf);
  } catch {
    return null;
  }
}

export async function readTemplateManifest(templateDir: string): Promise<TemplateManifest | null> {
  const manifestPath = path.join(templateDir, 'template.json');
  try {
    const raw = await fsPromises.readFile(manifestPath, 'utf-8');
    const parsed = TemplateManifestSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// Resolve the manifest mode for a given relative path. Exact entries win; if
// no exact match, walk the prefix directory entries (longest first). Fallback
// is the provided default mode.
export function getFileMode(
  relPath: string,
  manifest: TemplateManifest | null,
  defaultMode: FileMode
): FileMode {
  if (!manifest?.files) return defaultMode;
  const normalized = relPath.split(path.sep).join('/');
  if (manifest.files[normalized]) return manifest.files[normalized];

  const dirEntries = Object.entries(manifest.files).filter(([k]) => k.endsWith('/'));
  dirEntries.sort((a, b) => b[0].length - a[0].length);
  for (const [entry, mode] of dirEntries) {
    if (normalized.startsWith(entry)) return mode;
  }
  return defaultMode;
}

// Walk every file under `dir`, returning relative paths (posix-style). Skips
// template.json and settings.json at the root — both are template metadata
// that is read for its specific purpose but never copied to the target.
export async function walkTemplateFiles(
  dir: string,
  opts: { skipRoot?: string[] } = {}
): Promise<string[]> {
  const skipRoot = new Set(opts.skipRoot ?? ['template.json', 'settings.json']);
  const out: string[] = [];
  async function walk(current: string, prefix: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fsPromises.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(path.join(current, entry.name), rel);
      } else if (entry.isFile()) {
        if (!prefix && skipRoot.has(entry.name)) continue;
        out.push(rel);
      }
    }
  }
  await walk(dir, '');
  return out;
}

export type FileAction =
  | { action: 'write'; relPath: string; reason: 'new' | 'refresh' }
  | { action: 'skip-unchanged'; relPath: string }
  | { action: 'skip-diverged'; relPath: string; reason: 'edited' | 'no-recorded-sha' }
  | { action: 'skip-seed-once'; relPath: string }
  | { action: 'skip-absent-from-template'; relPath: string };

export interface RefreshPlan {
  actions: FileAction[];
  nextInstalled: InstalledFiles;
}

export interface RefreshOptions {
  defaultMode: FileMode;
  firstInstall?: boolean;
  accept?: boolean;
}

// Produce the per-file plan + the `installed-files.json` state that would
// follow from applying it. Does not touch disk — the caller decides whether
// to execute the plan.
export async function planRefresh(
  templateDir: string,
  targetDir: string,
  manifest: TemplateManifest | null,
  installed: InstalledFiles | null,
  options: RefreshOptions
): Promise<RefreshPlan> {
  const templateFiles = await walkTemplateFiles(templateDir);
  const actions: FileAction[] = [];
  const nextFiles: Record<string, { sha: string }> = {
    ...(installed?.files ?? {}),
  };

  for (const rel of templateFiles) {
    const mode = getFileMode(rel, manifest, options.defaultMode);
    const templatePath = path.join(templateDir, rel);
    const targetPath = path.join(targetDir, rel);
    const templateHash = sha256(await fsPromises.readFile(templatePath));

    if (options.firstInstall) {
      actions.push({ action: 'write', relPath: rel, reason: 'new' });
      nextFiles[rel] = { sha: templateHash };
      continue;
    }

    if (mode === 'seed-once') {
      const diskHash = await fileSha(targetPath);
      if (diskHash === null) {
        // Seed-once files that went missing are benign to re-seed.
        actions.push({ action: 'write', relPath: rel, reason: 'new' });
        nextFiles[rel] = { sha: templateHash };
      } else {
        actions.push({ action: 'skip-seed-once', relPath: rel });
      }
      continue;
    }

    // mode === 'track'
    const recorded = installed?.files?.[rel]?.sha;
    const diskHash = await fileSha(targetPath);

    if (diskHash === null) {
      // File vanished — re-seed it and update the SHA.
      actions.push({ action: 'write', relPath: rel, reason: 'refresh' });
      nextFiles[rel] = { sha: templateHash };
      continue;
    }

    if (!recorded) {
      if (options.accept) {
        actions.push({ action: 'write', relPath: rel, reason: 'refresh' });
        nextFiles[rel] = { sha: templateHash };
      } else {
        actions.push({ action: 'skip-diverged', relPath: rel, reason: 'no-recorded-sha' });
      }
      continue;
    }

    if (diskHash === templateHash) {
      actions.push({ action: 'skip-unchanged', relPath: rel });
      nextFiles[rel] = { sha: templateHash };
      continue;
    }

    if (diskHash === recorded || options.accept) {
      actions.push({ action: 'write', relPath: rel, reason: 'refresh' });
      nextFiles[rel] = { sha: templateHash };
    } else {
      actions.push({ action: 'skip-diverged', relPath: rel, reason: 'edited' });
    }
  }

  return {
    actions,
    nextInstalled: { files: nextFiles },
  };
}

export async function applyPlan(
  templateDir: string,
  targetDir: string,
  plan: RefreshPlan
): Promise<void> {
  for (const action of plan.actions) {
    if (action.action !== 'write') continue;
    const src = path.join(templateDir, action.relPath);
    const dst = path.join(targetDir, action.relPath);
    await fsPromises.mkdir(path.dirname(dst), { recursive: true });
    await fsPromises.copyFile(src, dst);
  }
}

export async function readInstalledFiles(filePath: string): Promise<InstalledFiles | null> {
  try {
    const raw = await fsPromises.readFile(filePath, 'utf-8');
    const parsed = InstalledFilesSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function writeInstalledFiles(filePath: string, data: InstalledFiles): Promise<void> {
  await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
  await fsPromises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// Return an installed-files slice scoped to keys starting with `prefix + '/'`,
// with the prefix stripped. Used by skill refresh, which runs a plan per
// skill against a shared `installed-files.json`.
export function sliceInstalledUnder(
  installed: InstalledFiles | null,
  prefix: string
): InstalledFiles | null {
  if (!installed?.files) return null;
  const p = `${prefix}/`;
  const filtered: Record<string, { sha: string }> = {};
  for (const [k, v] of Object.entries(installed.files)) {
    if (k.startsWith(p)) filtered[k.slice(p.length)] = v;
  }
  return { files: filtered };
}

// Re-key a plan's `actions` and `nextInstalled` entries by prefixing every
// `relPath`. Used for merging a skill plan (with skill-internal paths) back
// into the workdir-relative installed-files store.
export function prefixPlanKeys(plan: RefreshPlan, prefix: string): RefreshPlan {
  const p = prefix ? `${prefix}/` : '';
  return {
    actions: plan.actions.map((a) => ({ ...a, relPath: p + a.relPath })),
    nextInstalled: {
      files: Object.fromEntries(
        Object.entries(plan.nextInstalled.files ?? {}).map(([k, v]) => [p + k, v])
      ),
    },
  };
}
