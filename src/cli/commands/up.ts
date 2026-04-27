import { Command } from 'commander';
import { getDaemonClient } from '../client.js';
import {
  getAgent,
  getAgentOverlay,
  getPoliciesPath,
  getSocketPath,
  listAgents,
  refreshAgentTemplate,
  refreshAgentSkills,
  formatPlanActions,
} from '../../shared/workspace.js';
import fs from 'node:fs';
import path from 'node:path';
import { installBuiltinPolicies } from '../builtin-policies.js';
import { exportLiteToAllEnvironments } from '../../shared/lite.js';

// resolvePolicies only exposes built-ins when a policies file exists, so a
// fresh project needs an empty one for run-host etc. to be visible.
export function ensureDefaultPoliciesFile(): void {
  const policiesPath = getPoliciesPath();
  if (fs.existsSync(policiesPath)) return;
  fs.mkdirSync(path.dirname(policiesPath), { recursive: true });
  fs.writeFileSync(policiesPath, JSON.stringify({ policies: {} }, null, 2));
}

interface DivergedAction {
  action: 'skip-diverged';
  relPath: string;
  reason: 'edited' | 'no-recorded-sha';
}

function logPlanWarnings(
  agentId: string,
  directory: string | undefined,
  actions: Array<{ action: string; relPath: string; reason?: string }>
): void {
  const workdir = directory ?? agentId;
  for (const rawAction of actions) {
    if (rawAction.action !== 'skip-diverged') continue;
    const action = rawAction as DivergedAction;
    if (action.reason === 'edited') {
      console.warn(
        `./${path.join(workdir, action.relPath)} differs from template; skipping refresh. Run 'clawmini agents refresh ${agentId} --accept' to overwrite.`
      );
    } else if (action.reason === 'no-recorded-sha') {
      console.warn(
        `./${path.join(workdir, action.relPath)} has no recorded SHA; skipping. Run 'clawmini agents refresh ${agentId} --accept' to adopt the current file.`
      );
    }
  }
}

// Walk every agent and refresh its tracked files against the installed
// clawmini. Workdir-template refresh requires `extends`; skill refresh runs
// for any agent that hasn't opted out via `skillsDir: null`. Diverged files
// are skipped with a warning. Returns the aggregated plan actions for
// dry-run printing.
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
    if (!overlay) continue;

    try {
      if (overlay.extends) {
        const plan = await refreshAgentTemplate(
          agentId,
          overlay,
          process.cwd(),
          opts.dryRun ? { dryRun: true } : {}
        );
        if (plan) {
          logPlanWarnings(agentId, overlay.directory, plan.actions);
          output.push(...formatPlanActions(plan, { agentId }));
        }
      }

      const resolved = await getAgent(agentId);
      if (resolved) {
        const skillsPlan = await refreshAgentSkills(
          agentId,
          resolved,
          process.cwd(),
          opts.dryRun ? { dryRun: true } : {}
        );
        if (skillsPlan) {
          logPlanWarnings(agentId, overlay.directory, skillsPlan.actions);
          output.push(...formatPlanActions(skillsPlan, { agentId }));
        }
      }
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
          console.log('Dry run: no agents to refresh.');
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
