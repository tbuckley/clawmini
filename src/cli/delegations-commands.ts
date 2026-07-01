import { Command } from 'commander';
import type { createTRPCClient } from '@trpc/client';
import type { AgentRouter as AppRouter } from '../daemon/api/index.js';

// Kind-agnostic CLI surface for the unified delegation manager (spec §5.5).
// Mirrors the policy-`request` + `subagents` groups: every subcommand is a
// thin wrapper over a tRPC mutation/query that does the real work.

type WaitMode = 'any' | 'all';

type DelegationStateFilter =
  | 'pending'
  | 'running'
  | 'completed'
  | 'rejected'
  | 'failed'
  | 'resolved';
type DelegationKindFilter = 'policy' | 'subagent';

function reportError(err: unknown): never {
  console.error('Error:', err instanceof Error ? err.message : err);
  process.exit(1);
}

async function runWait(
  client: ReturnType<typeof createTRPCClient<AppRouter>>,
  ids: string[],
  opts: { all?: boolean; subscribe?: boolean; timeout?: number }
): Promise<void> {
  const mode: WaitMode = opts.all ? 'all' : 'any';
  if (opts.subscribe) {
    const result = await client.delegationWait.mutate({
      ids,
      mode,
      return: 'subscribe',
    });
    if (result.kind !== 'subscribe') {
      throw new Error(`Unexpected wait response kind: ${result.kind}`);
    }
    console.log(JSON.stringify({ subscriptionId: result.subscriptionId }, null, 2));
    return;
  }
  const timeoutMs = opts.timeout !== undefined ? opts.timeout * 1000 : 60_000;
  const result = await client.delegationWait.mutate({
    ids,
    mode,
    return: 'sync',
    timeoutMs,
  });
  if (result.kind !== 'sync') {
    throw new Error(`Unexpected wait response kind: ${result.kind}`);
  }
  console.log(JSON.stringify({ resolved: result.resolved, pending: result.pending }, null, 2));
}

export function registerDelegationsCommands(
  program: Command,
  getClient: () => ReturnType<typeof createTRPCClient<AppRouter>>
) {
  const delegations = program
    .command('delegations')
    .description('Manage cross-kind delegations (policies + subagents)');

  delegations
    .command('list')
    .description(
      'List delegations. Default returns pending + running. Use --state to filter and --kind to scope.'
    )
    .option(
      '-s, --state <state>',
      'Filter by state; comma-separated for multiple (e.g. pending,running,resolved,failed)'
    )
    .option('-k, --kind <kind>', 'Filter by kind (policy or subagent)')
    .option('--json', 'Output raw JSON records')
    .action(async (options: { state?: string; kind?: string; json?: boolean }) => {
      try {
        const client = getClient();
        // `--state` accepts a single value or a comma-separated list
        // (e.g. `--state completed,failed`) for parity with the endpoint's
        // array input. Empty entries are dropped.
        const stateFilter: DelegationStateFilter[] = options.state
          ? (options.state
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean) as DelegationStateFilter[])
          : ['pending', 'running'];

        const input: {
          state?: DelegationStateFilter[];
          kind?: DelegationKindFilter;
        } = { state: stateFilter };
        if (options.kind) input.kind = options.kind as DelegationKindFilter;

        const result = await client.delegationList.query(input);
        const records = result.delegations;

        if (options.json) {
          console.log(JSON.stringify(records, null, 2));
          return;
        }
        if (records.length === 0) {
          console.log('No delegations found.');
          return;
        }
        for (const d of records) {
          const head = `${d.id}  [${d.kind}]  state=${d.state}  delivery=${d.delivery}`;
          console.log(head);
          if (d.kind === 'policy') {
            console.log(`  command: ${d.commandName} ${d.args.join(' ')}`);
          } else {
            console.log(`  targetAgent: ${d.targetAgentId}`);
          }
          if (d.parentId) console.log(`  parentId: ${d.parentId}`);
          console.log(`  createdAt: ${d.createdAt}`);
        }
      } catch (err) {
        reportError(err);
      }
    });

  delegations
    .command('wait <ids...>')
    .description('Wait synchronously for one or more delegations to resolve.')
    .option('--all', 'Wait until every id resolves (default: any)')
    .option('--subscribe', 'Register a subscription and return immediately')
    .option('--timeout <seconds>', 'Sync timeout in seconds (default 60)', (v) => parseInt(v, 10))
    .action(
      async (ids: string[], options: { all?: boolean; subscribe?: boolean; timeout?: number }) => {
        try {
          const client = getClient();
          await runWait(client, ids, options);
        } catch (err) {
          reportError(err);
        }
      }
    );

  delegations
    .command('notify-when <ids...>')
    .description(
      'Alias for `delegations wait --subscribe`. Default mode is `any`; pass --all to require every id.'
    )
    .option('--all', 'Require every id to resolve before firing (default: any)')
    .action(async (ids: string[], options: { all?: boolean }) => {
      try {
        const client = getClient();
        await runWait(client, ids, { ...options, subscribe: true });
      } catch (err) {
        reportError(err);
      }
    });

  delegations
    .command('unsubscribe <subscriptionId>')
    .description(
      'Discard an active subscription. Pending members revert to their declared delivery.'
    )
    .action(async (subscriptionId: string) => {
      try {
        const client = getClient();
        await client.delegationUnsubscribe.mutate({ subscriptionId });
        console.log('ok');
      } catch (err) {
        reportError(err);
      }
    });

  delegations
    .command('show <id>')
    .description('Print the full delegation record for an id.')
    .action(async (id: string) => {
      try {
        const client = getClient();
        const result = await client.delegationShow.query({ id });
        console.log(JSON.stringify(result.delegation, null, 2));
      } catch (err) {
        reportError(err);
      }
    });

  delegations
    .command('delete <id>')
    .description(
      'Delete a delegation. Stops a running subagent first. Refuses while a subscription covers the id.'
    )
    .action(async (id: string) => {
      try {
        const client = getClient();
        const result = await client.delegationDelete.mutate({ id });
        if (result.deleted) console.log(`Delegation ${id} deleted`);
        else console.log(`Delegation ${id} not found`);
      } catch (err) {
        reportError(err);
      }
    });
}
