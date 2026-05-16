import { Command } from 'commander';
import type { createTRPCClient } from '@trpc/client';
import type { AgentRouter as AppRouter } from '../daemon/api/index.js';

// `clawmini-lite request <cmd>` — submit a sandbox policy request. Extracted
// from `lite.ts` so the entrypoint stays under the `max-lines: 300` ESLint
// cap. Ticket 7 (§3.3, §5.5) added `--delivery <manual|notify>`; on `manual`
// we additionally print a hint pointing at the `delegations` group for
// explicit observation.

type DeliveryMode = 'manual' | 'notify';

function resolveDeliveryOption(value: unknown): DeliveryMode | undefined {
  if (value === undefined) return undefined;
  if (value !== 'manual' && value !== 'notify') {
    throw new Error(`--delivery must be 'manual' or 'notify' (got '${String(value)}')`);
  }
  return value;
}

export function registerRequestCommand(
  program: Command,
  getClient: () => ReturnType<typeof createTRPCClient<AppRouter>>
) {
  program
    .command('request <cmd>')
    .description('Submit a sandbox policy request')
    .option('--help', 'Execute the underlying command with --help and print the output')
    .option('-f, --file <mappings...>', 'File mappings in the format name=path')
    .option(
      '--delivery <mode>',
      "How resolution is delivered: 'notify' (default for root) appends a <notification>; 'manual' (default for subagents) requires `delegations wait`/`show`."
    )
    .allowUnknownOption()
    .allowExcessArguments(true)
    .helpOption('-h, --cli-help', 'display CLI help for command')
    .action(async (cmdName, options, command) => {
      try {
        const client = getClient();
        const config = await client.listPolicies.query();
        const policy = config?.policies?.[cmdName];

        if (!policy) {
          throw new Error(`Policy not found: ${cmdName}`);
        }

        if (options.help) {
          const helpOutput = await client.executePolicyHelp.query({ commandName: cmdName });
          if (helpOutput.stdout) process.stdout.write(helpOutput.stdout);
          if (helpOutput.stderr) process.stderr.write(helpOutput.stderr);
          process.exit(helpOutput.exitCode);
        }

        const dashDashIndex = process.argv.indexOf('--');
        const opaqueArgs =
          dashDashIndex !== -1 ? process.argv.slice(dashDashIndex + 1) : command.args.slice(1);

        const fileMappings: Record<string, string> = {};
        if (options.file) {
          for (const mapping of options.file) {
            const [name, ...pathParts] = mapping.split('=');
            const pathStr = pathParts.join('=');
            if (!name || !pathStr) {
              throw new Error(`Invalid file mapping: ${mapping}. Expected format name=path`);
            }
            fileMappings[name] = pathStr;
          }
        }

        const delivery = resolveDeliveryOption(options.delivery);

        const request = await client.createPolicyRequest.mutate({
          commandName: cmdName,
          args: opaqueArgs,
          fileMappings,
          cwd: process.cwd(),
          ...(delivery !== undefined ? { delivery } : {}),
        });

        if (request.executionResult) {
          if (request.executionResult.stdout) process.stdout.write(request.executionResult.stdout);
          if (request.executionResult.stderr) process.stderr.write(request.executionResult.stderr);
          if (delivery === 'manual') {
            // Surface the explicit-observation hint on stderr so it doesn't
            // contaminate the captured stdout the caller may be piping.
            process.stderr.write(
              `Use 'clawmini-lite.js delegations wait ${request.id}' or 'delegations notify-when ${request.id}'.\n`
            );
          }
          process.exit(request.executionResult.exitCode);
        }

        console.log(`Request created successfully.`);
        console.log(`Request ID: ${request.id}`);
        console.log('');
        console.log('This request has not run yet — it is queued for user approval. When the');
        console.log('user approves (or rejects) it, the result will arrive as a new user');
        console.log('message in this chat; do not poll. Finish any unrelated work that does');
        console.log('not depend on this request, then end your turn with a brief message');
        console.log('explaining you are blocked on this request.');
      } catch (err) {
        console.error('Error:', err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });
}
