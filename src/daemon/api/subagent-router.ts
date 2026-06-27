import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { getWorkspaceRoot } from '../../shared/workspace.js';
import { apiProcedure } from './trpc.js';
import { createChatLogger } from '../agent/chat-logger.js';
import { createAgentSession } from '../agent/agent-session.js';
import { executeSubagent, getSubagentDepth } from './subagent-utils.js';
import { incrementSubagent, decrementSubagent } from '../agent/turn-registry.js';
import { DelegationManager } from '../delegation-manager.js';
import { DelegationStore } from '../delegation-store.js';
import type { SubagentDelegation } from '../../shared/delegations.js';

const MAX_SUBAGENT_DEPTH = 2;

export const subagentSpawn = apiProcedure
  .input(
    z.object({
      subagentId: z.string().optional(),
      targetAgentId: z.string().optional(),
      prompt: z.string(),
      async: z.boolean().optional(),
      delivery: z.enum(['notify', 'manual']).optional(),
    })
  )
  .mutation(async ({ input, ctx }) => {
    if (!ctx.tokenPayload) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Missing token' });
    const chatId = ctx.tokenPayload.chatId;
    const parentAgentId = ctx.tokenPayload.agentId;
    const parentId = ctx.tokenPayload.subagentId;
    const parentTurnId = ctx.tokenPayload.turnId;

    const agentId = input.targetAgentId || parentAgentId;
    const store = new DelegationStore();
    const manager = new DelegationManager(store);

    incrementSubagent(parentTurnId);
    let handedOff = false;
    try {
      const depth = await getSubagentDepth(chatId, parentId);
      if (depth >= MAX_SUBAGENT_DEPTH) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Max subagent depth reached' });
      }

      let deliveryMode: 'notify' | 'manual';
      if (input.delivery) {
        deliveryMode = input.delivery;
      } else if (input.async !== undefined) {
        deliveryMode = input.async ? 'notify' : 'manual';
      } else {
        deliveryMode = depth === 0 ? 'notify' : 'manual';
      }

      const delegation = await manager.createSubagent({
        chatId,
        agentId: parentAgentId,
        ...(parentId ? { parentId } : {}),
        targetAgentId: agentId,
        prompt: input.prompt,
        delivery: deliveryMode,
      });

      // Ticket 5 implies approvals are Ticket 8, so we auto-approve for now
      await manager.approve(chatId, delegation.id);

      const workspaceRoot = getWorkspaceRoot(process.cwd());

      handedOff = true;
      executeSubagent(
        chatId,
        delegation.id,
        delegation.targetAgentId,
        delegation.sessionId,
        delegation.prompt,
        delegation.delivery === 'notify',
        ctx.tokenPayload,
        workspaceRoot
      );

      return { id: delegation.id, depth, isAsync: delegation.delivery === 'notify' };
    } finally {
      if (!handedOff) decrementSubagent(parentTurnId);
    }
  });

export const subagentSend = apiProcedure
  .input(
    z.object({
      subagentId: z.string(),
      prompt: z.string(),
      async: z.boolean().optional(),
      delivery: z.enum(['notify', 'manual']).optional(),
    })
  )
  .mutation(async ({ input, ctx }) => {
    if (!ctx.tokenPayload) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Missing token' });
    const chatId = ctx.tokenPayload.chatId;
    const parentTurnId = ctx.tokenPayload.turnId;

    const store = new DelegationStore();
    const manager = new DelegationManager(store);

    incrementSubagent(parentTurnId);
    let handedOff = false;
    try {
      let sub;
      try {
        sub = await manager.assertVisibleTo(chatId, input.subagentId, ctx.tokenPayload.subagentId);
      } catch (err) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: err instanceof Error ? err.message : String(err),
        });
      }
      if (sub.kind !== 'subagent') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Delegation is not a subagent' });
      }

      let deliveryMode: 'notify' | 'manual' = sub.delivery;
      if (input.delivery) {
        deliveryMode = input.delivery;
      } else if (input.async !== undefined) {
        deliveryMode = input.async ? 'notify' : 'manual';
      }

      sub.delivery = deliveryMode;
      sub.state = 'running';
      sub.prompt = input.prompt;
      await store.save(sub);

      const workspaceRoot = getWorkspaceRoot(process.cwd());

      handedOff = true;
      executeSubagent(
        chatId,
        sub.id,
        sub.targetAgentId,
        sub.sessionId,
        input.prompt,
        deliveryMode === 'notify',
        ctx.tokenPayload,
        workspaceRoot
      );

      return { success: true };
    } finally {
      if (!handedOff) decrementSubagent(parentTurnId);
    }
  });

export const subagentWait = apiProcedure
  .input(z.object({ subagentId: z.string() }))
  .mutation(async ({ input, ctx, signal }) => {
    if (!ctx.tokenPayload) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Missing token' });
    const chatId = ctx.tokenPayload.chatId;

    const store = new DelegationStore();
    const manager = new DelegationManager(store);

    let result;
    try {
      result = await manager.wait({
        chatId,
        ids: [input.subagentId],
        mode: 'any',
        returnMode: 'sync',
        ...(ctx.tokenPayload.subagentId ? { callerSubagentId: ctx.tokenPayload.subagentId } : {}),
        ...(signal ? { signal } : {}),
      });
    } catch (err) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: err instanceof Error ? err.message : String(err),
      });
    }

    if (result.type === 'sync' && result.resolved.length > 0) {
      const sub = result.resolved[0] as SubagentDelegation;
      let outputContent: string | undefined;
      if (sub.state === 'completed') {
        const logger = createChatLogger(chatId, sub.id);
        const lastLogMessage = await logger.findLastMessage((m) => m.role === 'agent');
        if (lastLogMessage && 'content' in lastLogMessage) {
          outputContent = lastLogMessage.content;
        }
      }
      return { status: sub.state, output: outputContent };
    }

    return { status: 'active', output: undefined };
  });

export const subagentStop = apiProcedure
  .input(z.object({ subagentId: z.string() }))
  .mutation(async ({ input, ctx }) => {
    if (!ctx.tokenPayload) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Missing token' });
    const chatId = ctx.tokenPayload.chatId;

    const store = new DelegationStore();
    const manager = new DelegationManager(store);

    let sub;
    try {
      sub = await manager.assertVisibleTo(chatId, input.subagentId, ctx.tokenPayload.subagentId);
    } catch (err) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: err instanceof Error ? err.message : String(err),
      });
    }
    if (sub.kind !== 'subagent') {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Delegation is not a subagent' });
    }

    await manager.markResolved(chatId, sub.id, 'failed');

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

    const store = new DelegationStore();
    const manager = new DelegationManager(store);

    let sub;
    try {
      sub = await manager.assertVisibleTo(chatId, input.subagentId, ctx.tokenPayload.subagentId);
    } catch (err) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: err instanceof Error ? err.message : String(err),
      });
    }

    await manager.delete(chatId, input.subagentId);

    if (sub.kind === 'subagent') {
      const session = await createAgentSession({
        chatId,
        agentId: sub.targetAgentId,
        sessionId: sub.sessionId,
        subagentId: input.subagentId,
        cwd: process.cwd(),
      });
      session.stop();
    }

    return { success: true, deleted: true };
  });

export const subagentList = apiProcedure
  .input(z.object({ blocking: z.boolean().optional() }).optional())
  .query(async ({ input, ctx }) => {
    if (!ctx.tokenPayload) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Missing token' });
    const chatId = ctx.tokenPayload.chatId;

    const store = new DelegationStore();
    const manager = new DelegationManager(store);

    const isSubagent = !!ctx.tokenPayload.subagentId;
    const myId = ctx.tokenPayload.subagentId;

    const delegations = await manager.list(chatId);
    let subagents = delegations.filter((d) => d.kind === 'subagent' && d.parentId === myId);

    if (input?.blocking) {
      if (!isSubagent) {
        subagents = [];
      } else {
        subagents = subagents.filter((s) => s.state === 'running' || s.state === 'pending');
      }
    }

    // Map SubagentDelegation to the old SubagentTracker shape so we don't break the CLI commands yet,
    // though Ticket 9 will update CLI later. But wait, `status` is what the CLI might expect.
    return {
      subagents: subagents.map((s) => ({
        id: s.id,
        agentId: s.agentId,
        sessionId: (s as SubagentDelegation).sessionId,
        createdAt: s.createdAt,
        status: s.state === 'running' ? 'active' : s.state,
        parentId: s.parentId,
      })),
    };
  });

export const subagentTail = apiProcedure
  .input(z.object({ subagentId: z.string(), limit: z.number().optional() }))
  .query(async ({ input, ctx }) => {
    if (!ctx.tokenPayload) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Missing token' });
    const chatId = ctx.tokenPayload.chatId;

    const store = new DelegationStore();
    const manager = new DelegationManager(store);

    try {
      await manager.assertVisibleTo(chatId, input.subagentId, ctx.tokenPayload.subagentId);
    } catch (err) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: err instanceof Error ? err.message : String(err),
      });
    }

    const logger = createChatLogger(chatId, input.subagentId);
    const messages = await logger.getMessages(input.limit);

    return { messages };
  });
