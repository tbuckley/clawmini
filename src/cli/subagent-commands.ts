import { Command } from 'commander';
import type { createTRPCClient } from '@trpc/client';
import type { AgentRouter as AppRouter } from '../daemon/api/index.js';

export function registerSubagentCommands(
  program: Command,
  getClient: () => ReturnType<typeof createTRPCClient<AppRouter>>
) {
  const subagents = program.command('subagents').description('Manage subagents');

  subagents
    .command('spawn <targetAgentId>')
    .description('Spawn a new subagent')
    .option('-p, --prompt <prompt>', 'Prompt for the subagent', '')
    .option('-i, --id <subagentId>', 'Optional custom ID for the subagent')
    .action(async (targetAgentId, options) => {
      try {
        const client = getClient();
        const result = await client.subagentSpawn.mutate({
          targetAgentId,
          prompt: options.prompt,
          subagentId: options.id,
        });
        console.log(`Subagent spawned successfully with ID: ${result.id}`);
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
    .action(async () => {
      try {
        const client = getClient();
        const result = await client.subagentList.query();
        console.log(JSON.stringify(result.subagents, null, 2));
      } catch (err) {
        console.error('Error:', err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });
}
