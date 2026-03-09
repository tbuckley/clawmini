import { Command } from 'commander';
import path from 'node:path';
import {
  getLiteScriptContent,
  writeLiteScript,
  exportLiteToAllEnvironments,
} from '../../shared/lite.js';

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
      liteScriptContent = await getLiteScriptContent();
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
      finalPath = path.resolve(process.cwd(), options.out);
      try {
        const writtenPath = await writeLiteScript(finalPath);
        console.log(`Successfully exported clawmini-lite to ${writtenPath}`);
      } catch (err) {
        console.error(
          `Failed to export script: ${err instanceof Error ? err.message : String(err)}`
        );
        process.exit(1);
      }
      return;
    }

    const exportedToEnvironments = await exportLiteToAllEnvironments(process.cwd());

    if (!exportedToEnvironments) {
      try {
        const writtenPath = await writeLiteScript(finalPath);
        console.log(`Successfully exported clawmini-lite to ${writtenPath}`);
      } catch (err) {
        console.error(
          `Failed to export script: ${err instanceof Error ? err.message : String(err)}`
        );
        process.exit(1);
      }
    }
  });
