import { Command } from 'commander';
import fs from 'node:fs/promises';
import path from 'node:path';

const liteScriptContent = `#!/usr/bin/env node
/**
 * clawmini-lite - A standalone zero-dependency client
 */
const API_URL = process.env.CLAW_API_URL;
const API_TOKEN = process.env.CLAW_API_TOKEN;

async function main() {
  if (!API_URL || !API_TOKEN) {
    console.error('CLAW_API_URL and CLAW_API_TOKEN must be set in the environment.');
    process.exit(1);
  }
  
  // Basic sanity check, more functionality will be added
  console.log('clawmini-lite is working');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
`;

export const exportLiteCmd = new Command('export-lite')
  .description('Export the standalone clawmini-lite client script')
  .option(
    '-o, --out <path>',
    'Output path or directory for the script (defaults to current directory)'
  )
  .option('--stdout', 'Output the script to stdout instead of a file')
  .action(async (options: { out?: string; stdout?: boolean }) => {
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
