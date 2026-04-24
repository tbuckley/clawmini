import { Command } from 'commander';
import { getDaemonClient } from '../client.js';
import { getPoliciesPath, getSocketPath } from '../../shared/workspace.js';
import fs from 'node:fs';
import path from 'node:path';
import { installBuiltinPolicies } from '../builtin-policies.js';
import { exportLiteToAllEnvironments } from '../../shared/lite.js';

// resolvePolicies only exposes built-ins when a policies file exists, so a
// fresh project needs an empty one for run-host etc. to be visible.
function ensureDefaultPoliciesFile(): void {
  const policiesPath = getPoliciesPath();
  if (fs.existsSync(policiesPath)) return;
  fs.mkdirSync(path.dirname(policiesPath), { recursive: true });
  fs.writeFileSync(policiesPath, JSON.stringify({ policies: {} }, null, 2));
}

export const upCmd = new Command('up')
  .description('Start the local clawmini daemon server')
  .action(async () => {
    try {
      const socketPath = getSocketPath();
      const wasRunning = fs.existsSync(socketPath);

      await installBuiltinPolicies();
      ensureDefaultPoliciesFile();
      await exportLiteToAllEnvironments();

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
