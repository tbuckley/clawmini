import { Command } from 'commander';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const exportLiteCmd = new Command('export-lite')
  .description('Export the standalone clawmini-lite client script')
  .option(
    '-o, --out <path>',
    'Output path or directory for the script (defaults to current directory)'
  )
  .option('--stdout', 'Output the script to stdout instead of a file')
  .action(async (options: { out?: string; stdout?: boolean }) => {
    let liteScriptContent = '';
    try {
      const __dirname = path.dirname(fileURLToPath(import.meta.url));

      // When running from dist/cli/index.mjs, lite.mjs is in the same directory.
      let liteScriptPath = path.resolve(__dirname, 'lite.mjs');

      try {
        await fs.access(liteScriptPath);
      } catch {
        // Fallback for development/testing when running from src/cli/commands
        liteScriptPath = path.resolve(__dirname, '../../../dist/cli/lite.mjs');
      }

      liteScriptContent = await fs.readFile(liteScriptPath, 'utf8');

      // Ensure it has the hashbang (if tsdown stripped it or if missing)
      if (!liteScriptContent.startsWith('#!')) {
        liteScriptContent = '#!/usr/bin/env node\n' + liteScriptContent;
      }
    } catch (err) {
      console.error(
        `Failed to read compiled clawmini-lite script. Ensure you have built the project (npm run build). Error: ${err instanceof Error ? err.message : String(err)}`
      );
      process.exit(1);
    }

    if (options.stdout) {
      process.stdout.write(liteScriptContent);
      return;
    }

    const defaultFilename = 'clawmini-lite.js';
    let finalPath = path.resolve(process.cwd(), defaultFilename);

    if (options.out) {
      try {
        const stats = await fs.stat(options.out);
        if (stats.isDirectory()) {
          finalPath = path.resolve(options.out, defaultFilename);
        } else {
          finalPath = path.resolve(options.out);
        }
      } catch {
        // Path doesn't exist, assume it's a file path
        finalPath = path.resolve(options.out);
      }
    }

    try {
      await fs.writeFile(finalPath, liteScriptContent, { mode: 0o755 });
      console.log(`Successfully exported clawmini-lite to ${finalPath}`);
    } catch (err) {
      console.error(`Failed to export script: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });
