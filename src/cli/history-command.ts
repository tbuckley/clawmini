import { Command } from 'commander';
import type { createTRPCClient } from '@trpc/client';
import type { AgentRouter as AppRouter } from '../daemon/api/index.js';

export function registerHistoryCommand(
  program: Command,
  getClient: () => ReturnType<typeof createTRPCClient<AppRouter>>
) {
  program
    .command('history')
    .description('Print the user-visible thread history (oldest-first)')
    .option('--limit <n>', 'Maximum number of messages to return (default 20, max 200)', (v) =>
      parseInt(v, 10)
    )
    .option('--before <id>', 'Cursor: oldestId from a previous response')
    .option('--json', 'Print the JSON envelope as a single line')
    .action(async (options) => {
      try {
        const client = getClient();
        const input: { limit?: number; before?: string } = {};
        if (options.limit !== undefined) input.limit = options.limit;
        if (options.before !== undefined) input.before = options.before;
        const envelope = await client.getThreadHistory.query(input);

        if (options.json) {
          process.stdout.write(JSON.stringify(envelope) + '\n');
          return;
        }

        for (const msg of envelope.messages) {
          const tag = msg.role === 'user' ? '[USER]' : '[AGENT]';
          process.stdout.write(`${tag} ${msg.content}\n`);
        }
        if (envelope.hasMore) {
          process.stdout.write('---\n');
          process.stdout.write(`hasMore: true\n`);
          process.stdout.write(`oldestId: ${envelope.oldestId ?? ''}\n`);
        }
      } catch (err) {
        console.error('Error:', err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });
}
