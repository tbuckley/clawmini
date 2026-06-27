import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { apiProcedure } from './trpc.js';
import { DelegationStore } from '../delegation-store.js';
import { DelegationManager } from '../delegation-manager.js';

export const delegationWait = apiProcedure
  .input(
    z.object({
      ids: z.array(z.string()),
      mode: z.enum(['any', 'all']).default('any'),
      return: z.enum(['sync', 'subscribe']).default('sync'),
    })
  )
  .mutation(async ({ input, ctx, signal }) => {
    if (!ctx.tokenPayload) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Missing token' });

    const store = new DelegationStore();
    const manager = new DelegationManager(store);

    const result = await manager.wait({
      chatId: ctx.tokenPayload.chatId,
      ids: input.ids,
      mode: input.mode,
      returnMode: input.return,
      callerAgentId: ctx.tokenPayload.agentId,
      callerSessionId: ctx.tokenPayload.sessionId,
      ...(ctx.tokenPayload.subagentId ? { callerSubagentId: ctx.tokenPayload.subagentId } : {}),
      ...(ctx.tokenPayload.turnId ? { callerTurnId: ctx.tokenPayload.turnId } : {}),
      ...(signal ? { signal } : {}),
    });

    if (result.type === 'sync') {
      return {
        type: 'sync',
        resolved: result.resolved.map((d) => ({
          id: d.id,
          kind: d.kind,
          state: d.state,
        })),
      };
    } else {
      return { type: 'subscribe', subscriptionId: result.subscriptionId };
    }
  });

export const delegationList = apiProcedure.input(z.object({}).optional()).query(async ({ ctx }) => {
  if (!ctx.tokenPayload) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Missing token' });

  const store = new DelegationStore();
  const manager = new DelegationManager(store);

  const delegations = await manager.list(ctx.tokenPayload.chatId);

  // Filter to only those visible to caller
  const myId = ctx.tokenPayload.subagentId;
  const visible = delegations.filter((d) => d.parentId === myId);

  return { delegations: visible };
});

export const delegationUnsubscribe = apiProcedure
  .input(z.object({ subscriptionId: z.string() }))
  .mutation(async ({ input, ctx }) => {
    if (!ctx.tokenPayload) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Missing token' });

    const store = new DelegationStore();
    const manager = new DelegationManager(store);

    const removed = manager.unsubscribe(input.subscriptionId);
    return { success: removed };
  });
