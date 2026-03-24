export interface PolicyDefinition {
  description?: string;
  command: string;
  args?: string[];
  allowHelp?: boolean;
  autoApprove?: boolean;
}

export interface PolicyConfig {
  policies: Record<string, PolicyDefinition>;
}

export type RequestState = 'Pending' | 'Approved' | 'Rejected';

export interface PolicyRequest {
  id: string;
  commandName: string;
  args: string[];
  fileMappings: Record<string, string>;
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
