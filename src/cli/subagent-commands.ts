import { Command } from 'commander';
import type { createTRPCClient } from '@trpc/client';
import type { AgentRouter as AppRouter } from '../daemon/api/index.js';

// Subagent-specific CLI surface. Ticket 6 dropped `wait`, `list`, and `delete`
// from this group — those now live under `delegations` (kind-agnostic, see
// `delegations-commands.ts`). The remaining commands are `spawn`, `send`,
// `stop`, and `tail`. Sync spawn/send no longer poll — they call
// `delegationWait` once and unwrap the subagent's last agent reply for the
// legacy `<subagent_output>` output.
//
// Ticket 7 introduced `--delivery <manual|notify>` as the canonical delivery
// selector (spec §3.3, §5.5). Ticket 8 removes the deprecated `--async`
// boolean entirely — `--delivery` is now the only flag.

type DeliveryMode = 'manual' | 'notify';

function parseDelivery(value: string | undefined): DeliveryMode | undefined {
  if (value === undefined) return undefined;
  if (value !== 'manual' && value !== 'notify') {
    throw new Error(`--delivery must be 'manual' or 'notify' (got '${value}')`);
  }
  return value;
}

function printManualHint(id: string): void {
  console.log(`Use 'clawmini-lite.js delegations wait ${id}' or 'delegations notify-when ${id}'.`);
}

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
    .option(
      '--delivery <mode>',
      "How resolution is delivered: 'notify' (default for root) appends a <notification>; 'manual' (default for subagents) requires `delegations wait`."
    )
    .action(async (message, options) => {
      try {
        const client = getClient();
        const delivery = parseDelivery(options.delivery);
        const result = await client.subagentSpawn.mutate({
          targetAgentId: options.agent,
          prompt: message,
          subagentId: options.id,
          ...(delivery !== undefined ? { delivery } : {}),
        });
        console.log(`Subagent spawned successfully with ID: ${result.id}`);

        if (result.delivery === 'manual') {
          // Per Ticket 7: a manual-delivery spawn returns immediately and the
          // caller is expected to observe the result via the `delegations`
          // group. Print a hint so the agent doesn't have to remember the
          // exact command names.
          printManualHint(result.id);
          return;
        }
        if (!result.isAsync) {
          console.log(`Waiting for subagent ${result.id} to complete...`);
          await waitAndPrintSubagent(client, result.id);
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
    .option(
      '--delivery <mode>',
      "How resolution is delivered: 'notify' (default for root) appends a <notification>; 'manual' (default for subagents) requires `delegations wait`."
    )
    .action(async (subagentId, options) => {
      try {
        const client = getClient();
        const delivery = parseDelivery(options.delivery);
        const result = await client.subagentSend.mutate({
          subagentId,
          prompt: options.prompt,
          ...(delivery !== undefined ? { delivery } : {}),
        });
        console.log(`Message sent to subagent ${subagentId}`);

        if (result.delivery === 'manual') {
          printManualHint(subagentId);
          return;
        }
        if (delivery === 'notify') {
          // The mutation already returned; the subagent runs asynchronously
          // and will append its own <notification> on completion. Nothing
          // more to do here.
          return;
        }
        await waitAndPrintSubagent(client, subagentId);
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
            if (msg.role === 'user' || msg.displayRole === 'user') {
              console.log(`[USER] ${msg.content}`);
            } else if (msg.role === 'agent' || msg.displayRole === 'agent') {
              console.log(`[AGENT] ${msg.content.trim()}`);
            } else if (msg.role === 'policy') {
              if ('commandName' in msg) {
                console.log(`[POLICY] ${msg.commandName} ${msg.args.join(' ')}`);
              } else {
                console.log(`[POLICY] ${msg.operation} ${msg.fromAgent} → ${msg.toAgent}`);
              }
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

// Run a single sync delegationWait for `subagentId`, then format the
// completed subagent's last agent-role reply the same way the legacy
// poll loop did. Used by both `subagents spawn` (non-async) and
// `subagents send` (non-async).
async function waitAndPrintSubagent(
  client: ReturnType<typeof createTRPCClient<AppRouter>>,
  subagentId: string
): Promise<void> {
  const wait = await client.delegationWait.mutate({
    ids: [subagentId],
    mode: 'any',
    return: 'sync',
    timeoutMs: 60_000,
  });
  if (wait.kind !== 'sync') {
    console.log(`Subagent status: unknown`);
    return;
  }
  const record = wait.resolved[0] ?? wait.pending[0];
  if (!record || record.kind !== 'subagent') {
    console.log(`Subagent status: unknown`);
    return;
  }
  if (record.state === 'running' || record.state === 'pending') {
    console.log(`Subagent status: active`);
    return;
  }
  if (record.state !== 'completed') {
    console.log(`Subagent status: ${record.state}`);
    return;
  }
  const tail = await client.subagentTail.query({ subagentId });
  let output: string | undefined;
  for (let i = tail.messages.length - 1; i >= 0; i--) {
    const msg = tail.messages[i];
    if (msg && msg.role === 'agent' && 'content' in msg) {
      output = msg.content;
      break;
    }
  }
  if (output !== undefined) {
    console.log(`\n<subagent_output>\n${output}\n</subagent_output>`);
  } else {
    console.log(`Subagent status: completed`);
  }
}
