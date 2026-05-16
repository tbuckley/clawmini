import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { apiProcedure } from './trpc.js';
import { delegationManager } from '../delegation-manager.js';
import { createAgentSession } from '../agent/agent-session.js';
import { DelegationStore } from '../delegation-store.js';
import { getWorkspaceRoot } from '../../shared/workspace.js';

// Agent-facing tRPC endpoints for the unified `delegations` surface. Backs
// the `delegations` CLI group (Ticket 6) plus the lite client's wait/spawn
// flows. Ticket 5 landed `delegationWait` + `delegationUnsubscribe`; Ticket 6
// rounds out the surface with `delegationList`, `delegationShow`, and
// `delegationDelete`.

export const delegationWait = apiProcedure
  .input(
    z.object({
      ids: z.array(z.string()).min(1),
      mode: z.enum(['any', 'all']),
      return: z.enum(['sync', 'subscribe']),
      timeoutMs: z.number().int().positive().optional(),
    })
  )
  .mutation(async ({ input, ctx }) => {
    if (!ctx.tokenPayload) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Missing token' });
    const chatId = ctx.tokenPayload.chatId;

    if (input.return === 'subscribe') {
      const out = await delegationManager.wait({
        ids: input.ids,
        mode: input.mode,
        return: 'subscribe',
        chatId,
        originSessionId: ctx.tokenPayload.sessionId,
      });
      return { kind: 'subscribe' as const, subscriptionId: out.subscriptionId };
    }

    const result = await delegationManager.wait({
      ids: input.ids,
      mode: input.mode,
      return: 'sync',
      chatId,
      ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
    });
    return { kind: 'sync' as const, resolved: result.resolved, pending: result.pending };
  });

export const delegationUnsubscribe = apiProcedure
  .input(z.object({ subscriptionId: z.string() }))
  .mutation(async ({ input, ctx }) => {
    if (!ctx.tokenPayload) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Missing token' });
    const chatId = ctx.tokenPayload.chatId;
    // Validate the subscription exists in this chat first. The manager's
    // in-memory observer might be gone (already fired or daemon restart wiped
    // it) but the on-disk file is authoritative for "does this id exist".
    // Returning NOT_FOUND lets the CLI exit non-zero on a double-unsubscribe.
    const store = new DelegationStore(getWorkspaceRoot());
    const record = await store.loadSubscription(chatId, input.subscriptionId);
    if (!record) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: `Subscription not found: ${input.subscriptionId}`,
      });
    }
    await delegationManager.unsubscribe(input.subscriptionId);
    return { success: true };
  });

const DelegationKindSchema = z.enum(['policy', 'subagent']);
const DelegationStateSchema = z.enum(['pending', 'running', 'completed', 'rejected', 'failed']);
// The CLI exposes a `--state resolved` convenience that maps to the three
// terminal states (completed | rejected | failed). The wire schema lists each
// real state plus the synthetic 'resolved' bucket; the endpoint expands it.
const DelegationStateFilterSchema = z.union([DelegationStateSchema, z.literal('resolved')]);
const RESOLVED_STATES = ['completed', 'rejected', 'failed'] as const;

export const delegationList = apiProcedure
  .input(
    z
      .object({
        kind: DelegationKindSchema.optional(),
        state: z
          .union([DelegationStateFilterSchema, z.array(DelegationStateFilterSchema)])
          .optional(),
      })
      .optional()
  )
  .query(async ({ input, ctx }) => {
    if (!ctx.tokenPayload) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Missing token' });
    const chatId = ctx.tokenPayload.chatId;
    // Scope to the caller's subagent context: a subagent only sees its direct
    // children; the root agent only sees root-spawned delegations. This
    // mirrors the legacy `subagentList` authorization and is the same scope
    // used by approval / wait / show / delete from the caller's perspective.
    const callerSubagentId = ctx.tokenPayload.subagentId;

    const stateInput = input?.state;
    const expanded: Array<'pending' | 'running' | 'completed' | 'rejected' | 'failed'> = [];
    const list = Array.isArray(stateInput) ? stateInput : stateInput ? [stateInput] : [];
    for (const s of list) {
      if (s === 'resolved') expanded.push(...RESOLVED_STATES);
      else expanded.push(s);
    }
    // De-duplicate while preserving order.
    const states = Array.from(new Set(expanded));

    const filter: {
      chatId: string;
      kind?: 'policy' | 'subagent';
      state?: typeof states;
    } = { chatId };
    if (input?.kind !== undefined) filter.kind = input.kind;
    if (states.length > 0) filter.state = states;

    // Authorization filter: scope to delegations whose `parentId` matches the
    // caller's subagent context (matches the legacy `subagentList` behavior).
    // We filter in code because the store's `parentId` filter requires a
    // defined value, and root callers have `undefined`.
    const records = (await delegationManager.list(filter)).filter(
      (d) => d.parentId === callerSubagentId
    );
    return { delegations: records };
  });

export const delegationShow = apiProcedure
  .input(z.object({ id: z.string() }))
  .query(async ({ input, ctx }) => {
    if (!ctx.tokenPayload) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Missing token' });
    const chatId = ctx.tokenPayload.chatId;
    const record = await delegationManager.get(input.id, chatId);
    if (!record) {
      throw new TRPCError({ code: 'NOT_FOUND', message: `Delegation not found: ${input.id}` });
    }
    return { delegation: record };
  });

export const delegationDelete = apiProcedure
  .input(z.object({ id: z.string() }))
  .mutation(async ({ input, ctx }) => {
    if (!ctx.tokenPayload) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Missing token' });
    const chatId = ctx.tokenPayload.chatId;

    const record = await delegationManager.get(input.id, chatId);
    if (!record) {
      throw new TRPCError({ code: 'NOT_FOUND', message: `Delegation not found: ${input.id}` });
    }

    // Refuse while a subscription still covers this id. Subscriptions live on
    // disk under `.clawmini/tmp/delegations/<chatId>/subscriptions/`; if any
    // active record's `ids` includes the target, the user must `delegations
    // unsubscribe <subscriptionId>` first. This guards against deleting the
    // delegation out from under the observer.
    const store = new DelegationStore(getWorkspaceRoot());
    const subs = await store.listSubscriptions(chatId);
    const blocking = subs.find((s) => s.ids.includes(input.id));
    if (blocking) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Delegation ${input.id} is covered by subscription ${blocking.subscriptionId}; unsubscribe first`,
      });
    }

    // If this is a running subagent, stop the underlying session before
    // removing the record so the process doesn't leak.
    if (record.kind === 'subagent' && record.state === 'running') {
      await delegationManager.markResolved(record.id, {
        state: 'failed',
        reason: 'Stopped by delegationDelete',
      });
      const session = await createAgentSession({
        chatId,
        agentId: record.targetAgentId,
        sessionId: record.sessionId,
        subagentId: record.id,
        cwd: process.cwd(),
      });
      session.stop();
    }

    await delegationManager.delete(input.id, chatId);
    return { success: true, deleted: true };
  });
