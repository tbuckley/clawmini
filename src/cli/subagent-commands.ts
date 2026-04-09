import { Command } from 'commander';
import type { createTRPCClient } from '@trpc/client';
import type { AgentRouter as AppRouter } from '../daemon/api/index.js';
import type { SubagentTracker } from '../shared/config.js';
import { readSettings } from '../shared/workspace.js';

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

        if (!result.isAsync) {
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
        let result;
        do {
          result = await client.subagentWait.mutate({ subagentId });
        } while (result.status === 'active');

        if (result.status === 'completed' && 'output' in result && result.output) {
          console.log(result.output);
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

        for (const sub of subagents as SubagentTracker[]) {
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
        let messages = result.messages;

        const settings = await readSettings(process.cwd());

        if (settings?.timestampPrefix !== false) {
          messages = messages.map((msg) => {
            if (msg.role === 'user' || msg.displayRole === 'user') {
              const date = new Date(msg.timestamp);
              const pad = (n: number) => String(n).padStart(2, '0');
              const YYYY = date.getFullYear();
              const MM = pad(date.getMonth() + 1);
              const DD = pad(date.getDate());
              const HH = pad(date.getHours());
              const MIN = pad(date.getMinutes());

              let z = '';
              try {
                const parts = new Intl.DateTimeFormat('en-US', {
                  timeZoneName: 'short',
                }).formatToParts(date);
                const tzPart = parts.find((p) => p.type === 'timeZoneName');
                if (tzPart) z = tzPart.value;
              } catch {
                // Ignore
              }

              if (!z) {
                const offset = -date.getTimezoneOffset();
                const sign = offset >= 0 ? '+' : '-';
                z = `GMT${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
              }

              const prefix = `[${YYYY}-${MM}-${DD} ${HH}:${MIN} ${z}] `;
              return {
                ...msg,
                content: `${prefix}${msg.content}`,
              };
            }
            return msg;
          });
        }

        if (options.json) {
          messages.forEach((msg) => console.log(JSON.stringify(msg)));
        } else {
          messages.forEach((msg) => {
            if (msg.role === 'user' || msg.displayRole === 'user') {
              console.log(`[USER] ${msg.content}`);
            } else if (msg.role === 'agent' || msg.displayRole === 'agent') {
              console.log(`[AGENT] ${msg.content.trim()}`);
            } else if (msg.role === 'policy') {
              console.log(`[POLICY] ${msg.commandName} ${msg.args.join(' ')}`);
            } else if (msg.role === 'tool') {
              console.log(`[TOOL] ${msg.name}`);
            } else if (msg.role === 'system') {
              if (msg.content) {
                console.log(`[LOG] ${msg.content.trim()}`);
              }
            } else if (msg.role === 'command' || msg.role === 'legacy_log') {
              if (msg.content) {
                console.log(`[LOG] ${msg.content.trim()}`);
              } else if (msg.stderr) {
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
