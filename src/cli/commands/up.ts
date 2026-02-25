import { Command } from 'commander';
import { getDaemonClient } from '../client.js';
import { getSocketPath } from '../../shared/workspace.js';
import fs from 'node:fs';

export const upCmd = new Command('up')
  .description('Start the local clawmini daemon server')
  .action(async () => {
    try {
      const socketPath = getSocketPath();
      const wasRunning = fs.existsSync(socketPath);

      const client = await getDaemonClient({ autoStart: true });
      // Perform a ping to ensure the server is responding
      await client.ping.query();

      if (wasRunning) {
        console.log('Daemon is already running.');
      } else {
        console.log('Successfully started clawmini daemon.');
      }
    } catch (err: unknown) {
      console.error('Failed to start daemon:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });
