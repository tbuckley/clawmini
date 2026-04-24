import { Command } from 'commander';
import { getDaemonClient } from '../client.js';
import { getSocketPath } from '../../shared/workspace.js';
import { readSupervisorPid } from '../supervisor-pid.js';
import fs from 'node:fs';

async function stopSupervisor(pid: number): Promise<void> {
  process.stdout.write(`Stopping clawmini supervisor (pid ${pid})`);
  try {
    process.kill(pid, 'SIGTERM');
  } catch (err) {
    throw new Error(
      `Failed to signal supervisor: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err }
    );
  }

  // Poll until the process is gone or we time out.
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200));
    process.stdout.write('.');
    try {
      process.kill(pid, 0);
    } catch {
      process.stdout.write('\nSuccessfully shut down clawmini supervisor.\n');
      return;
    }
  }
  throw new Error('Supervisor did not exit within 30 seconds.');
}

export const downCmd = new Command('down')
  .description('Stop the local clawmini supervisor or daemon')
  .action(async () => {
    const supPid = readSupervisorPid();
    if (supPid) {
      try {
        await stopSupervisor(supPid);
        return;
      } catch (err) {
        console.error('\n', err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    }

    try {
      const client = await getDaemonClient({ autoStart: false });
      process.stdout.write('Shutting down clawmini daemon...');
      await client.shutdown.mutate();

      const socketPath = getSocketPath();
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
