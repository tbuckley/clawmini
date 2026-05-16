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
  // `executeRequest` now takes a structural `{args, fileMappings}` (Ticket 8
  // dropped the legacy `PolicyRequest` type), which the delegation satisfies
  // directly — no rebuild needed.
  return executeRequest(
    { args: delegation.args, fileMappings: delegation.fileMappings },
    policy,
    cwd
  );
}
