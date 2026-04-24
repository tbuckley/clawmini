import { Command } from 'commander';
import { getDaemonClient } from '../client.js';
import {
  getAgentOverlay,
  getPoliciesPath,
  getSocketPath,
  listAgents,
  refreshAgentTemplate,
  formatPlanActions,
} from '../../shared/workspace.js';
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

// Walk every agent with `extends` set and refresh its `track` files against
// the template. Diverged files are skipped with a warning. Returns the
// aggregated plan actions for dry-run printing.
export async function refreshAllAgents(opts: { dryRun?: boolean } = {}): Promise<string[]> {
  const output: string[] = [];
  const agentIds = await listAgents();
  for (const agentId of agentIds) {
    let overlay;
    try {
      overlay = await getAgentOverlay(agentId);
    } catch (err) {
      console.warn(
        `Skipping refresh for agent '${agentId}': ${err instanceof Error ? err.message : String(err)}`
      );
      continue;
    }
    if (!overlay?.extends) continue;

    try {
      const plan = await refreshAgentTemplate(
        agentId,
        overlay,
        process.cwd(),
        opts.dryRun ? { dryRun: true } : {}
      );
      if (!plan) continue;
      for (const action of plan.actions) {
        if (action.action === 'skip-diverged' && action.reason === 'edited') {
          console.warn(
            `./${path.join(overlay.directory ?? agentId, action.relPath)} differs from template; skipping refresh. Run 'clawmini agents refresh ${agentId} --accept' to overwrite.`
          );
        } else if (action.action === 'skip-diverged' && action.reason === 'no-recorded-sha') {
          console.warn(
            `./${path.join(overlay.directory ?? agentId, action.relPath)} has no recorded SHA; skipping. Run 'clawmini agents refresh ${agentId} --accept' to adopt the current file.`
          );
        }
      }
      output.push(...formatPlanActions(plan, { agentId }));
    } catch (err) {
      console.warn(
        `Failed to refresh agent '${agentId}': ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  return output;
}

export const upCmd = new Command('up')
  .description('Start the local clawmini daemon server')
  .option('--dry-run', 'Print the per-file refresh plan without writing anything')
  .action(async (options: { dryRun?: boolean }) => {
    try {
      const socketPath = getSocketPath();
      const wasRunning = fs.existsSync(socketPath);

      if (options.dryRun) {
        const lines = await refreshAllAgents({ dryRun: true });
        if (lines.length === 0) {
          console.log('Dry run: no agents with `extends` to refresh.');
        } else {
          for (const line of lines) console.log(line);
        }
        return;
      }

      await installBuiltinPolicies();
      ensureDefaultPoliciesFile();
      await exportLiteToAllEnvironments();
      await refreshAllAgents();

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
