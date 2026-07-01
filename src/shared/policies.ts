import type { SubagentRule } from './approvals.js';

export interface PolicyDefinition {
  description?: string;
  command: string;
  args?: string[];
  allowHelp?: boolean;
  autoApprove?: boolean;
}

// Resolved policy config: built-ins merged in, `false` overrides stripped.
// This is what every consumer should see. The `subagents` rule list is the
// **user** rules only — built-in rules (e.g. `$self → $self`) are appended at
// evaluation time inside `resolveSubagentApproval` (`src/shared/approvals.ts`).
export interface PolicyConfig {
  policies: Record<string, PolicyDefinition>;
  subagents?: SubagentRule[];
}

// On-disk shape: `false` opts a built-in out, a definition opts in / overrides.
export interface PolicyConfigFile {
  policies: Record<string, PolicyDefinition | false>;
  // Ordered list of approval rules for subagent spawn/send. Ticket 4 (§4).
  // First-match-wins; the built-in `$self → $self` rule is appended at
  // evaluation time, so users only need to include carve-outs here.
  subagents?: SubagentRule[];
}

export const BUILTIN_POLICY_SCRIPTS_DIR = '.clawmini/policy-scripts';

export const BUILTIN_POLICIES: Record<string, PolicyDefinition> = {
  'manage-policies': {
    description:
      'Add, update, or remove clawmini policies (subcommands: add, update, remove). Reads are unrestricted via `requests show`.',
    command: `./${BUILTIN_POLICY_SCRIPTS_DIR}/manage-policies.js`,
    allowHelp: true,
    autoApprove: false,
  },
  'run-host': {
    description: 'Run an arbitrary shell command on the host via `sh -c`',
    command: `./${BUILTIN_POLICY_SCRIPTS_DIR}/run-host.js`,
    allowHelp: true,
    autoApprove: false,
  },
};

// Ticket 8 removed the legacy `PolicyRequest` / `RequestState` types. The
// authoritative shape is now `PolicyDelegation` in
// `src/shared/delegations.ts`.
