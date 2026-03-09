import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSettings, readEnvironment, getWorkspaceRoot } from './workspace.js';
import type { Environment } from './config.js';

export async function getLiteScriptContent(): Promise<string> {
  let liteScriptContent: string;
  const __dirname = path.dirname(fileURLToPath(import.meta.url));

  let liteScriptPath = path.resolve(__dirname, 'cli/lite.mjs'); // if bundled in a shared chunk at dist/

  try {
    await fs.access(liteScriptPath);
  } catch {
    try {
      // If bundled in dist/cli or dist/daemon and lite is next to it
      liteScriptPath = path.resolve(__dirname, 'lite.mjs');
      await fs.access(liteScriptPath);
    } catch {
      try {
        // If bundled in dist/daemon, it might be in ../cli/lite.mjs
        liteScriptPath = path.resolve(__dirname, '../cli/lite.mjs');
        await fs.access(liteScriptPath);
      } catch {
        // Fallback for development/testing when running from src/shared
        liteScriptPath = path.resolve(__dirname, '../../dist/cli/lite.mjs');
      }
    }
  }

  liteScriptContent = await fs.readFile(liteScriptPath, 'utf8');

  // Ensure it has the hashbang (if tsdown stripped it or if missing)
  if (!liteScriptContent.startsWith('#!')) {
    liteScriptContent = '#!/usr/bin/env node\n' + liteScriptContent;
  }
  return liteScriptContent;
}

export async function writeLiteScript(outPath: string): Promise<string> {
  const content = await getLiteScriptContent();

  let finalPath = outPath;
  const isDir =
    finalPath.endsWith(path.sep) ||
    !(
      path.extname(finalPath) === '.js' ||
      path.extname(finalPath) === '.mjs' ||
      path.basename(finalPath) === 'clawmini-lite'
    );

  try {
    const stat = await fs.stat(finalPath);
    if (stat.isDirectory()) {
      finalPath = path.join(finalPath, 'clawmini-lite.js');
    }
  } catch {
    if (
      isDir &&
      !path.extname(finalPath) &&
      !finalPath.endsWith('clawmini-lite') &&
      !finalPath.endsWith('clawmini-lite.js')
    ) {
      await fs.mkdir(finalPath, { recursive: true });
      finalPath = path.join(finalPath, 'clawmini-lite.js');
    }
  }

  const dir = path.dirname(finalPath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(finalPath, content, { mode: 0o755 });
  return finalPath;
}

export async function exportLiteToEnvironment(
  envName: string,
  envConfig: Environment,
  affectedDir: string
): Promise<boolean> {
  if (!envConfig?.exportLiteTo) return false;

  const finalExportPath = path.resolve(affectedDir, envConfig.exportLiteTo);

  if (
    !finalExportPath.startsWith(affectedDir + path.sep) &&
    finalExportPath !== affectedDir &&
    !finalExportPath.startsWith(affectedDir + '/')
  ) {
    console.warn(
      `Skipping export for environment '${envName}': exportLiteTo path '${envConfig.exportLiteTo}' escapes the environment target directory '${affectedDir}'`
    );
    return false;
  }

  try {
    const writtenPath = await writeLiteScript(finalExportPath);
    console.log(`Successfully exported clawmini-lite to ${writtenPath} (Environment: ${envName})`);
    return true;
  } catch (err) {
    console.error(
      `Failed to export clawmini-lite to ${finalExportPath} (Environment: ${envName}): ${err instanceof Error ? err.message : String(err)}`
    );
    return false;
  }
}

export async function exportLiteToAllEnvironments(startDir = process.cwd()): Promise<boolean> {
  let exportedToEnvironments = false;
  try {
    const workspaceRoot = getWorkspaceRoot(startDir);
    const settings = await readSettings(workspaceRoot);
    if (settings?.environments) {
      for (const [envPath, envName] of Object.entries(settings.environments)) {
        const envConfig = await readEnvironment(envName, workspaceRoot);
        if (envConfig) {
          const affectedDir = path.resolve(workspaceRoot, envPath);
          const exported = await exportLiteToEnvironment(envName, envConfig, affectedDir);
          if (exported) {
            exportedToEnvironments = true;
          }
        }
      }
    }
  } catch {
    // Ignore settings read errors
  }
  return exportedToEnvironments;
}
