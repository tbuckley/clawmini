export interface PolicyDefinition {
  description?: string;
  command: string;
  args?: string[];
  allowHelp?: boolean;
  autoApprove?: boolean;
}

// Resolved policy config: built-ins merged in, `false` overrides stripped.
// This is what every consumer should see.
export interface PolicyConfig {
  policies: Record<string, PolicyDefinition>;
}

// On-disk shape: `false` opts a built-in out, a definition opts in / overrides.
export interface PolicyConfigFile {
  policies: Record<string, PolicyDefinition | false>;
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

export type RequestState = 'Pending' | 'Approved' | 'Rejected';

export interface PolicyRequest {
  id: string;
  commandName: string;
  args: string[];
  fileMappings: Record<string, string>;
  cwd?: string;
  state: RequestState;
  createdAt: number;
  rejectionReason?: string;
  chatId: string;
  agentId: string;
  subagentId?: string;
  executionResult?: {
    stdout: string;
    stderr: string;
    exitCode: number;
  };
}
