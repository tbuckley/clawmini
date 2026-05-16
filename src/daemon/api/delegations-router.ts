import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { apiProcedure } from './trpc.js';
import { delegationManager } from '../delegation-manager.js';

// Agent-facing tRPC endpoints for the unified `delegations` surface.
// Ticket 5 lands just enough to make the wait-core / subscription tests
// reachable from the agent CLI side (via the tRPC client). Ticket 6 owns
// the full router (`delegationList`, `delegationShow`, `delegationDelete`,
// `delegations notify-when` alias). Keeping the file under the 300-line
// cap with room to grow.

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
    await delegationManager.unsubscribe(input.subscriptionId);
    return { success: true };
  });
