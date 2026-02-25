import { Command } from 'commander';
import { getDaemonClient } from '../client.js';

export const downCmd = new Command('down')
  .description('Stop the local clawmini daemon server')
  .action(async () => {
    try {
      const client = await getDaemonClient({ autoStart: false });
      await client.shutdown.mutate();
      console.log('Successfully shut down clawmini daemon.');
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'Daemon not running.') {
        console.log('Daemon is not running.');
      } else {
        console.error(
          'Failed to shut down daemon:',
          err instanceof Error ? err.message : String(err)
        );
        process.exit(1);
      }
    }
  });
