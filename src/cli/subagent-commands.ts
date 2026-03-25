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
          async: options.async,
        });
        console.log(`Subagent spawned successfully with ID: ${result.id}`);

        if (!options.async) {
          console.log(`Waiting for subagent ${result.id} to complete...`);
          let waitResult;
          do {
            waitResult = await client.subagentWait.mutate({ subagentId: result.id });
          } while (waitResult.status === 'active');

          if (waitResult.status === 'completed' && waitResult.output) {
            console.log(`\n<subagent_output>\n${waitResult.output}\n</subagent_output>`);
          } else {
            console.log(`Subagent status: ${waitResult.status}`);
          }
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
    .option('--async', 'Run asynchronously without blocking')
    .action(async (subagentId, options) => {
      try {
        const client = getClient();
        await client.subagentSend.mutate({
          subagentId,
          prompt: options.prompt,
          async: options.async,
        });
        console.log(`Message sent to subagent ${subagentId}`);

        if (!options.async) {
          let waitResult;
          do {
            waitResult = await client.subagentWait.mutate({ subagentId });
          } while (waitResult.status === 'active');

          if (waitResult.status === 'completed' && waitResult.output) {
            console.log(`\n<subagent_output>\n${waitResult.output}\n</subagent_output>`);
          } else {
            console.log(`Subagent status: ${waitResult.status}`);
          }
        }
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
        console.log(`Waiting for subagent ${subagentId} to complete...`);
        let result;
        do {
          result = await client.subagentWait.mutate({ subagentId });
        } while (result.status === 'active');

        if (result.status === 'completed' && (result as any).output) {
          console.log(
            `\n=== Subagent Output ===\n${(result as any).output}\n=======================`
          );
        } else {
          console.log(`Subagent status: ${result.status}`);
        }
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
    .option('--blocking', 'Filter for subagents that block the current agent')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        const client = getClient();
        const result = await client.subagentList.query({ blocking: options.blocking });
        const subagents = result.subagents;

        if (options.json) {
          console.log(JSON.stringify(subagents, null, 2));
          return;
        }

        if (subagents.length === 0) {
          console.log('No subagents found.');
          return;
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

  subagents
    .command('tail <subagentId>')
    .description('View message history for a specific subagent')
    .option('-n, --lines <number>', 'Number of messages to show', parseInt)
    .option('--json', 'Output raw JSONL format')
    .action(async (subagentId, options) => {
      try {
        const client = getClient();
        const result = await client.subagentTail.query({
          subagentId,
          limit: options.lines,
        });
        const messages = result.messages;

        if (options.json) {
          messages.forEach((msg) => console.log(JSON.stringify(msg)));
        } else {
          messages.forEach((msg) => {
            if (msg.role === 'user') {
              console.log(`[USER] ${msg.content}`);
            } else if (msg.role === 'log') {
              if (msg.content) {
                console.log(`[LOG] ${msg.content.trim()}`);
              } else if ('stderr' in msg && msg.stderr) {
                console.error(`[STDERR] ${msg.stderr.trim()}`);
              }
            }
          });
        }
      } catch (err) {
        console.error('Error:', err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });
}
