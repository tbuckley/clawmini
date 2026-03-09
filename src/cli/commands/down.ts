import { Command } from 'commander';
import { getDaemonClient } from '../client.js';
import { getSocketPath } from '../../shared/workspace.js';
import fs from 'node:fs';

export const downCmd = new Command('down')
  .description('Stop the local clawmini daemon server')
  .action(async () => {
    try {
      const client = await getDaemonClient({ autoStart: false });
      process.stdout.write('Shutting down clawmini daemon...');
      await client.shutdown.mutate();

      const socketPath = getSocketPath();
      // Wait for the socket file to be removed by the daemon's exit handler
      while (fs.existsSync(socketPath)) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        process.stdout.write('.');
      }
      console.log('\nSuccessfully shut down clawmini daemon.');
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'Daemon not running.') {
        console.log('Daemon is not running.');
      } else {
        console.error(
          '\nFailed to shut down daemon:',
          err instanceof Error ? err.message : String(err)
        );
        process.exit(1);
      }
    }
  });
