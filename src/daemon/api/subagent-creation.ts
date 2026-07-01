import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { getWorkspaceRoot } from '../../shared/workspace.js';
import { apiProcedure } from './trpc.js';
import { executeSubagent, getSubagentDepth } from './subagent-utils.js';
import {
  appendSubagentApprovalPreview,
  resolveSubagentEdgeAutoApprove,
} from './subagent-approval.js';
import { incrementSubagent, decrementSubagent } from '../agent/turn-registry.js';
import { delegationManager } from '../delegation-manager.js';
import { assertVisibleSubagent, resolveDelivery, MAX_SUBAGENT_DEPTH } from './subagent-shared.js';

// `subagentSpawn` and `subagentSend` live here (rather than in
// `subagent-router.ts`) so the router file stays under the `max-lines: 300`
// ESLint rule. Both endpoints share approval gating (§4.4) and the same
// pending → /approve → `executeSubagent` hand-off pattern.

export const subagentSpawn = apiProcedure
  .input(
    z.object({
      subagentId: z.string().optional(),
      targetAgentId: z.string().optional(),
      prompt: z.string(),
      delivery: z.enum(['notify', 'manual']).optional(),
    })
  )
  .mutation(async ({ input, ctx }) => {
    if (!ctx.tokenPayload) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Missing token' });
    const chatId = ctx.tokenPayload.chatId;
    const parentAgentId = ctx.tokenPayload.agentId;
    const parentId = ctx.tokenPayload.subagentId;
    const parentTurnId = ctx.tokenPayload.turnId;

    const sessionId = randomUUID();
    const targetAgentId = input.targetAgentId || parentAgentId;

    const depth = await getSubagentDepth(chatId, parentId);
    if (depth >= MAX_SUBAGENT_DEPTH) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Max subagent depth reached' });
    }

    const delivery = resolveDelivery(input.delivery, depth);
    const workspaceRoot = getWorkspaceRoot(process.cwd());

    // Approval gating: spec §4.4. The check fires on every spawn AND every
    // send — see `subagentSend` below for the matching code path.
    const edge = await resolveSubagentEdgeAutoApprove(parentAgentId, targetAgentId, workspaceRoot);

    // We only increment the parent turn's subagent counter when we're about
    // to call `executeSubagent`. For a pending (not auto-approved) spawn we
    // never execute, so the parent turn does not need to wait on us.
    if (edge.autoApprove) incrementSubagent(parentTurnId);
    let handedOff = false;
    try {
      let created;
      try {
        created = await delegationManager.createSubagent({
          chatId,
          agentId: parentAgentId,
          targetAgentId,
          sessionId,
          prompt: input.prompt,
          ...(parentId ? { parentId } : {}),
          ...(input.subagentId !== undefined ? { id: input.subagentId } : {}),
          delivery,
          autoApprove: edge.autoApprove,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('Subagent ID already exists')) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Subagent ID already exists' });
        }
        throw err;
      }

      const isAsync = delivery === 'notify';

      if (!edge.autoApprove) {
        await appendSubagentApprovalPreview(
          chatId,
          created.id,
          edge.fromPath,
          edge.toPath,
          'spawn',
          input.prompt,
          {
            sessionId: ctx.tokenPayload.sessionId,
            turnId: ctx.tokenPayload.turnId,
            subagentId: ctx.tokenPayload.subagentId,
          }
        );
        return {
          id: created.id,
          depth,
          isAsync,
          delivery,
          state: 'pending' as const,
          requiresApproval: true,
        };
      }

      handedOff = true;
      executeSubagent(
        chatId,
        created.id,
        targetAgentId,
        sessionId,
        input.prompt,
        isAsync,
        ctx.tokenPayload,
        workspaceRoot
      );

      return {
        id: created.id,
        depth,
        isAsync,
        delivery,
        state: 'running' as const,
        requiresApproval: false,
      };
    } finally {
      if (edge.autoApprove && !handedOff) decrementSubagent(parentTurnId);
    }
  });

export const subagentSend = apiProcedure
  .input(
    z.object({
      subagentId: z.string(),
      prompt: z.string(),
      delivery: z.enum(['notify', 'manual']).optional(),
    })
  )
  .mutation(async ({ input, ctx }) => {
    if (!ctx.tokenPayload) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Missing token' });
    const chatId = ctx.tokenPayload.chatId;
    const parentTurnId = ctx.tokenPayload.turnId;
    const parentId = ctx.tokenPayload.subagentId;

    const sub = await assertVisibleSubagent(parentId, input.subagentId, chatId);

    const depth = await getSubagentDepth(chatId, parentId);
    const delivery = resolveDelivery(input.delivery, depth);
    const workspaceRoot = getWorkspaceRoot(process.cwd());

    // Same approval edge as spawn (§4.4 — "per-message approval"). Even
    // after an initial spawn was approved, a follow-up send can re-cross a
    // boundary and needs its own check.
    const edge = await resolveSubagentEdgeAutoApprove(
      ctx.tokenPayload.agentId,
      sub.targetAgentId,
      workspaceRoot
    );

    if (!edge.autoApprove) {
      await delegationManager.sendToSubagent(sub.id, chatId, input.prompt, {
        autoApprove: false,
      });
      await appendSubagentApprovalPreview(
        chatId,
        sub.id,
        edge.fromPath,
        edge.toPath,
        'send',
        input.prompt,
        {
          sessionId: ctx.tokenPayload.sessionId,
          turnId: ctx.tokenPayload.turnId,
          subagentId: ctx.tokenPayload.subagentId,
        }
      );
      return { success: true, delivery, state: 'pending' as const, requiresApproval: true };
    }

    incrementSubagent(parentTurnId);
    let handedOff = false;
    try {
      await delegationManager.sendToSubagent(sub.id, chatId, input.prompt, {
        autoApprove: true,
      });

      const isAsync = delivery === 'notify';

      handedOff = true;
      executeSubagent(
        chatId,
        sub.id,
        sub.targetAgentId,
        sub.sessionId,
        input.prompt,
        isAsync,
        ctx.tokenPayload,
        workspaceRoot
      );

      return {
        success: true,
        delivery,
        state: 'running' as const,
        requiresApproval: false,
      };
    } finally {
      if (!handedOff) decrementSubagent(parentTurnId);
    }
  });
