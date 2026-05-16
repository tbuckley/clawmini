import type { PolicyDelegation } from '../shared/delegations.js';
import type { PolicyDefinition } from '../shared/policies.js';
import { executeRequest } from './policy-utils.js';

// Pure executor for policy delegations. Ticket 2 moved all storage onto
// `DelegationManager` — this module no longer touches the file system. It
// just resolves the policy's `command`/`args`, interpolates the snapshotted
// `fileMappings` from the delegation, and runs the script in the given cwd.
//
// `DelegationManager.approve()` (and the auto-approve path in
// `agent-policy-endpoints.createPolicyRequest`) calls `execute(delegation,
// policy, cwd)` and feeds the result back via `markResolved`.

export interface PolicyExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  commandStr: string;
}

export async function executePolicyDelegation(
  delegation: PolicyDelegation,
  policy: PolicyDefinition,
  cwd?: string
): Promise<PolicyExecutionResult> {
  // executeRequest accepts a structural subset (commandName/args/fileMappings),
  // which PolicyDelegation satisfies. Cast at this single boundary so callers
  // can keep using the delegation type throughout.
  return executeRequest(
    {
      id: delegation.id,
      commandName: delegation.commandName,
      args: delegation.args,
      fileMappings: delegation.fileMappings,
      ...(delegation.cwd ? { cwd: delegation.cwd } : {}),
      state: 'Pending',
      createdAt: Date.parse(delegation.createdAt) || Date.now(),
      chatId: delegation.chatId,
      agentId: delegation.agentId,
      ...(delegation.parentId ? { subagentId: delegation.parentId } : {}),
    },
    policy,
    cwd
  );
}
