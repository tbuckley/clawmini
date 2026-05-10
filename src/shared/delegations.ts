export type DelegationKind = 'policy' | 'subagent';
export type DelegationState = 'pending' | 'running' | 'completed' | 'rejected' | 'failed';
export type DeliveryMode = 'notify' | 'manual';

export interface DelegationBase {
  id: string; // 3-char alphanum, unique per chat
  kind: DelegationKind;
  state: DelegationState;
  delivery: DeliveryMode;
  chatId: string;
  agentId: string; // creator's agent
  parentId?: string; // creator's subagent id, if any
  createdAt: string;
  resolvedAt?: string;
  rejectionReason?: string;
}

export interface PolicyDelegation extends DelegationBase {
  kind: 'policy';
  commandName: string;
  args: string[];
  fileMappings: Record<string, string>;
  cwd?: string;
  executionResult?: { stdout: string; stderr: string; exitCode: number };
}

export interface SubagentDelegation extends DelegationBase {
  kind: 'subagent';
  targetAgentId: string;
  sessionId: string;
  prompt: string; // last prompt sent; refreshed on `subagentSend`
}

export type Delegation = PolicyDelegation | SubagentDelegation;
