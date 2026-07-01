import { z } from 'zod';

export type DelegationKind = 'policy' | 'subagent';
export type DelegationState = 'pending' | 'running' | 'completed' | 'rejected' | 'failed';
export type DeliveryMode = 'notify' | 'manual';

// Fields shared by both delegation kinds. See spec §5.6 (Unified record).
interface DelegationBase {
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

const DelegationStateSchema = z.enum(['pending', 'running', 'completed', 'rejected', 'failed']);

const DeliveryModeSchema = z.enum(['notify', 'manual']);

const ExecutionResultSchema = z.object({
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number(),
});

const PolicyDelegationSchema = z.object({
  id: z.string(),
  kind: z.literal('policy'),
  state: DelegationStateSchema,
  delivery: DeliveryModeSchema,
  chatId: z.string(),
  agentId: z.string(),
  parentId: z.string().optional(),
  createdAt: z.string(),
  resolvedAt: z.string().optional(),
  rejectionReason: z.string().optional(),
  commandName: z.string(),
  args: z.array(z.string()),
  fileMappings: z.record(z.string(), z.string()),
  cwd: z.string().optional(),
  executionResult: ExecutionResultSchema.optional(),
});

const SubagentDelegationSchema = z.object({
  id: z.string(),
  kind: z.literal('subagent'),
  state: DelegationStateSchema,
  delivery: DeliveryModeSchema,
  chatId: z.string(),
  agentId: z.string(),
  parentId: z.string().optional(),
  createdAt: z.string(),
  resolvedAt: z.string().optional(),
  rejectionReason: z.string().optional(),
  targetAgentId: z.string(),
  sessionId: z.string(),
  prompt: z.string(),
});

export const DelegationSchema = z.discriminatedUnion('kind', [
  PolicyDelegationSchema,
  SubagentDelegationSchema,
]);

// Subscription record. Persisted under `subscriptions/<subscriptionId>.json`.
// Consumed by later tickets (Ticket 5+); included here so the store has a
// single source of truth for what it reads/writes.
export interface DelegationSubscription {
  subscriptionId: string;
  chatId: string;
  originSessionId: string;
  ids: string[];
  mode: 'any' | 'all';
  createdAt: string;
}

export const DelegationSubscriptionSchema = z.object({
  subscriptionId: z.string(),
  chatId: z.string(),
  originSessionId: z.string(),
  ids: z.array(z.string()),
  mode: z.enum(['any', 'all']),
  createdAt: z.string(),
});
