import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { apiProcedure } from './trpc.js';
import { createChatLogger } from '../agent/chat-logger.js';
import { createAgentSession } from '../agent/agent-session.js';
import { delegationManager } from '../delegation-manager.js';
import { assertVisibleSubagent } from './subagent-shared.js';
import type { SubagentDelegation } from '../../shared/delegations.js';

// `subagentSpawn` and `subagentSend` live in `subagent-creation.ts` because
// they share approval-gating helpers and would push this file over the
// `max-lines: 300` ESLint rule. The router barrel (`api/index.ts`) imports
// them from there. The remaining endpoints (stop/delete/list/tail) live
// here. Ticket 8 removed `subagentWait` — callers use the kind-agnostic
// `delegationWait` instead.

export { subagentSpawn, subagentSend } from './subagent-creation.js';

export const subagentStop = apiProcedure
  .input(z.object({ subagentId: z.string() }))
  .mutation(async ({ input, ctx }) => {
    if (!ctx.tokenPayload) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Missing token' });
    const chatId = ctx.tokenPayload.chatId;
    const callerSubagentId = ctx.tokenPayload.subagentId;

    const sub = await assertVisibleSubagent(callerSubagentId, input.subagentId, chatId);

    // Only mark as failed if the subagent is currently running. If it's
    // already terminal, the stop is a no-op (matches today's idempotency).
    if (sub.state === 'running') {
      await delegationManager.markResolved(sub.id, {
        state: 'failed',
        reason: 'Stopped by subagentStop',
      });
    }

    const session = await createAgentSession({
      chatId,
      agentId: sub.targetAgentId,
      sessionId: sub.sessionId,
      subagentId: input.subagentId,
      cwd: process.cwd(),
    });
    session.stop();

    return { success: true };
  });

export const subagentDelete = apiProcedure
  .input(z.object({ subagentId: z.string() }))
  .mutation(async ({ input, ctx }) => {
    if (!ctx.tokenPayload) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Missing token' });
    const chatId = ctx.tokenPayload.chatId;
    const callerSubagentId = ctx.tokenPayload.subagentId;

    const sub = await assertVisibleSubagent(callerSubagentId, input.subagentId, chatId);

    const session = await createAgentSession({
      chatId,
      agentId: sub.targetAgentId,
      sessionId: sub.sessionId,
      subagentId: input.subagentId,
      cwd: process.cwd(),
    });
    session.stop();

    await delegationManager.delete(sub.id, chatId);

    return { success: true, deleted: true };
  });

export const subagentList = apiProcedure
  .input(z.object({ blocking: z.boolean().optional() }).optional())
  .query(async ({ input, ctx }) => {
    if (!ctx.tokenPayload) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Missing token' });
    const chatId = ctx.tokenPayload.chatId;
    const isSubagent = !!ctx.tokenPayload.subagentId;
    const myId = ctx.tokenPayload.subagentId;

    // Direct children only — matches today's tracker map filter on parentId.
    // `list` filters `parentId` strictly with `=== filter.parentId`, so passing
    // `undefined` here naturally matches root-spawned subagents (records that
    // omit `parentId`).
    const all = await delegationManager.list({
      chatId,
      kind: 'subagent',
    });
    const subagents = all
      .filter((d): d is SubagentDelegation => d.kind === 'subagent')
      .filter((d) => d.parentId === myId);

    let filtered = subagents;
    if (input?.blocking) {
      if (!isSubagent) {
        filtered = [];
      } else {
        // 'active' tracker == 'running' delegation. Approval-gated pending
        // records (Ticket 4) are not blocking — they cannot run yet so the
        // caller has nothing to wait on.
        filtered = subagents.filter((s) => s.state === 'running');
      }
    }

    // Shape the response so existing CLI/test consumers keep working: they
    // read `id`, `agentId`, `sessionId`, `createdAt`, `status`, `parentId`.
    // 'status' is a derived field — 'active' for running, otherwise the
    // delegation's terminal state.
    const shaped = filtered.map((d) => ({
      id: d.id,
      agentId: d.targetAgentId,
      sessionId: d.sessionId,
      createdAt: d.createdAt,
      status: d.state === 'running' ? 'active' : d.state,
      ...(d.parentId !== undefined ? { parentId: d.parentId } : {}),
    }));

    return { subagents: shaped };
  });

export const subagentTail = apiProcedure
  .input(z.object({ subagentId: z.string(), limit: z.number().optional() }))
  .query(async ({ input, ctx }) => {
    if (!ctx.tokenPayload) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Missing token' });
    const chatId = ctx.tokenPayload.chatId;
    const callerSubagentId = ctx.tokenPayload.subagentId;

    await assertVisibleSubagent(callerSubagentId, input.subagentId, chatId);

    const logger = createChatLogger(chatId, input.subagentId);
    const messages = await logger.getMessages(input.limit);

    return { messages };
  });
