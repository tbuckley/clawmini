import { Command } from 'commander';
import type { createTRPCClient } from '@trpc/client';
import type { AgentRouter as AppRouter } from '../daemon/api/index.js';

export function registerSubagentCommands(
  program: Command,
  getClient: () => ReturnType<typeof createTRPCClient<AppRouter>>
) {
  const subagents = program.command('subagents').description('Manage subagents');

  subagents
    .command('spawn <message>')
    .description('Spawn a new subagent')
    .option('-a, --agent <name>', 'Target agent name')
    .option('-i, --id <subagentId>', 'Optional custom ID for the subagent')
    .option('--async', 'Run asynchronously without blocking')
    .action(async (message, options) => {
      try {
        const client = getClient();
        const result = await client.subagentSpawn.mutate({
          targetAgentId: options.agent,
          prompt: message,
          subagentId: options.id,
        });
        console.log(`Subagent spawned successfully with ID: ${result.id}`);

        if (!options.async && result.depth > 0) {
          console.log(`Waiting for subagent ${result.id} to complete...`);
          let waitResult;
          do {
            waitResult = await client.subagentWait.mutate({ subagentId: result.id });
          } while (waitResult.status === 'active');
          console.log(`Subagent status: ${waitResult.status}`);
        }
      } catch (err) {
        console.error('Error:', err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });

  subagents
    .command('send <subagentId>')
    .description('Send a message to a subagent')
    .requiredOption('-p, --prompt <prompt>', 'Prompt to send')
    .action(async (subagentId, options) => {
      try {
        const client = getClient();
        await client.subagentSend.mutate({
          subagentId,
          prompt: options.prompt,
        });
        console.log(`Message sent to subagent ${subagentId}`);
      } catch (err) {
        console.error('Error:', err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });

  subagents
    .command('wait <subagentId>')
    .description('Wait for a subagent to complete')
    .action(async (subagentId) => {
      try {
        const client = getClient();
        const result = await client.subagentWait.mutate({ subagentId });
        console.log(`Subagent status: ${result.status}`);
      } catch (err) {
        console.error('Error:', err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });

  subagents
    .command('stop <subagentId>')
    .description('Stop a subagent')
    .action(async (subagentId) => {
      try {
        const client = getClient();
        await client.subagentStop.mutate({ subagentId });
        console.log(`Subagent ${subagentId} stopped`);
      } catch (err) {
        console.error('Error:', err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });

  subagents
    .command('delete <subagentId>')
    .description('Delete a subagent')
    .action(async (subagentId) => {
      try {
        const client = getClient();
        const result = await client.subagentDelete.mutate({ subagentId });
        if (result.deleted) {
          console.log(`Subagent ${subagentId} deleted`);
        } else {
          console.log(`Subagent ${subagentId} not found`);
        }
      } catch (err) {
        console.error('Error:', err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });

  subagents
    .command('list')
    .description('List all subagents')
    .option('--pending', 'Filter for active subagents')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        const client = getClient();
        const result = await client.subagentList.query();
        let subagents = result.subagents;

        if (options.pending) {
          subagents = subagents.filter((s: any) => s.status === 'active' || s.status === 'pending');
        }

        if (options.json) {
          console.log(JSON.stringify(subagents, null, 2));
          return;
        }

        if (subagents.length === 0) {
          console.log('No subagents found.');
          return;
        }

        for (const sub of subagents as any[]) {
          console.log(`\n=== Subagent: ${sub.id || 'N/A'} ===`);
          console.log(`  Agent:      ${sub.agentId || 'N/A'}`);
          console.log(`  Status:     ${sub.status || 'N/A'}`);
          console.log(`  Created:    ${sub.createdAt || 'N/A'}`);
          console.log(`  Session ID: ${sub.sessionId || 'N/A'}`);
          if (sub.parentId) console.log(`  Parent ID:  ${sub.parentId}`);
        }
        console.log();
      } catch (err) {
        console.error('Error:', err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });
}
