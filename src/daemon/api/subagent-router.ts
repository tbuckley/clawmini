import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { getWorkspaceRoot } from '../../shared/workspace.js';
import { apiProcedure } from './trpc.js';
import { createChatLogger } from '../agent/chat-logger.js';
import { createAgentSession } from '../agent/agent-session.js';
import { executeSubagent, getSubagentDepth } from './subagent-utils.js';
import { incrementSubagent, decrementSubagent } from '../agent/turn-registry.js';
import { delegationManager } from '../delegation-manager.js';
import type { SubagentDelegation, DeliveryMode } from '../../shared/delegations.js';

const MAX_SUBAGENT_DEPTH = 2;

// Map the legacy boolean `async` flag to the new `delivery` mode. Spec §3.3:
//   true  → 'notify'  (today's async — wakeup notification on resolve)
//   false → 'manual'  (today's sync wait — caller polls subagentWait)
// `async` survives one release as a deprecated alias (see §8 step 5).
function resolveDelivery(
  delivery: DeliveryMode | undefined,
  asyncFlag: boolean | undefined,
  depth: number
): DeliveryMode {
  if (delivery !== undefined) return delivery;
  if (asyncFlag !== undefined) return asyncFlag ? 'notify' : 'manual';
  // Default: root agents (depth 0) get 'notify' (today's async-by-default),
  // subagents (depth ≥ 1) get 'manual' (today's sync-by-default).
  return depth === 0 ? 'notify' : 'manual';
}

// Convert the manager's `assertVisibleTo` errors into TRPCError so the wire
// surface matches the legacy `assertSubagentAccess` (NOT_FOUND / FORBIDDEN).
async function assertVisibleSubagent(
  callerSubagentId: string | undefined,
  id: string,
  chatId: string
): Promise<SubagentDelegation> {
  try {
    return await delegationManager.assertVisibleTo(callerSubagentId, id, chatId);
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    const message = err instanceof Error ? err.message : String(err);
    if (code === 'NOT_FOUND') {
      throw new TRPCError({ code: 'NOT_FOUND', message });
    }
    if (code === 'FORBIDDEN') {
      throw new TRPCError({ code: 'FORBIDDEN', message });
    }
    throw err;
  }
}

export const subagentSpawn = apiProcedure
  .input(
    z.object({
      subagentId: z.string().optional(),
      targetAgentId: z.string().optional(),
      prompt: z.string(),
      // `async` is a deprecated alias for `delivery` — see resolveDelivery.
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

    // `subagentId` (CLI --id) is still accepted as a back-compat shim so
    // tests and tooling that pin a known id keep working. When omitted, the
    // delegation store mints a 3-char alphanum id (Ticket 3 spec, §5.6).
    const sessionId = randomUUID();
    const targetAgentId = input.targetAgentId || parentAgentId;

    // Compute depth via the new delegation graph (no more ChatSettings map).
    const depth = await getSubagentDepth(chatId, parentId);
    if (depth >= MAX_SUBAGENT_DEPTH) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Max subagent depth reached' });
    }

    const delivery = resolveDelivery(input.delivery, input.async, depth);

    // Increment synchronously before any await so a sibling subagent's
    // completion cannot decrement the parent's counter to zero (firing
    // turnEnded) during the window before executeSubagent is called.
    incrementSubagent(parentTurnId);
    let handedOff = false;
    try {
      // Create the delegation record. For Ticket 3 we always autoApprove
      // (today's behavior is no gating on spawn); Ticket 4 will gate this
      // behind the `subagents` rule list in policies.json.
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
          autoApprove: true,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('Subagent ID already exists')) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Subagent ID already exists' });
        }
        throw err;
      }

      const workspaceRoot = getWorkspaceRoot(process.cwd());
      const isAsync = delivery === 'notify';

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

      return { id: created.id, depth, isAsync, delivery };
    } finally {
      if (!handedOff) decrementSubagent(parentTurnId);
    }
  });

export const subagentSend = apiProcedure
  .input(
    z.object({
      subagentId: z.string(),
      prompt: z.string(),
      // Deprecated alias for `delivery` — see resolveDelivery.
      async: z.boolean().optional(),
      delivery: z.enum(['notify', 'manual']).optional(),
    })
  )
  .mutation(async ({ input, ctx }) => {
    if (!ctx.tokenPayload) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Missing token' });
    const chatId = ctx.tokenPayload.chatId;
    const parentTurnId = ctx.tokenPayload.turnId;
    const parentId = ctx.tokenPayload.subagentId;

    // Authorize + load via the manager.
    const sub = await assertVisibleSubagent(parentId, input.subagentId, chatId);

    // For Ticket 3 the send path mirrors today: no approval gating, the
    // child is woken with the new prompt, status flips back to running.
    // Ticket 4 will add the approval check via `manager.sendToSubagent`.
    const depth = await getSubagentDepth(chatId, parentId);
    const delivery = resolveDelivery(input.delivery, input.async, depth);

    incrementSubagent(parentTurnId);
    let handedOff = false;
    try {
      // Refresh the prompt + flip state back to running. The manager.update
      // path lets us write both atomically; lifecycle (markResolved) will
      // fire again on completion.
      await delegationManager.update(sub.id, chatId, {
        prompt: input.prompt,
        state: 'running',
      });

      const workspaceRoot = getWorkspaceRoot(process.cwd());
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

      return { success: true, delivery };
    } finally {
      if (!handedOff) decrementSubagent(parentTurnId);
    }
  });

export const subagentWait = apiProcedure
  .input(z.object({ subagentId: z.string() }))
  .mutation(async ({ input, ctx }) => {
    if (!ctx.tokenPayload) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Missing token' });
    const chatId = ctx.tokenPayload.chatId;
    const callerSubagentId = ctx.tokenPayload.subagentId;

    // Authorize before waiting so an unauthorized caller fails fast (matches
    // the legacy behavior even though the wait itself is now generic).
    await assertVisibleSubagent(callerSubagentId, input.subagentId, chatId);

    // Thin wrapper over the manager's wait. Ticket 5 generalises wait to
    // multi-id / mode=all / subscribe; for now we only need single-id sync.
    const result = await delegationManager.wait({
      ids: [input.subagentId],
      mode: 'any',
      return: 'sync',
      chatId,
      timeoutMs: 60_000,
    });

    const record = result.resolved[0] ?? result.pending[0];
    if (!record || record.kind !== 'subagent') {
      // Either the id vanished (deleted mid-flight) or the wait timed out
      // without a record. Surface as still-active so the CLI's poll loop
      // can retry — matches today's timeout return.
      return { status: 'active' as const, output: undefined };
    }
    if (record.state === 'running' || record.state === 'pending') {
      return { status: 'active' as const, output: undefined };
    }
    if (record.state === 'completed') {
      // Today's CLI expects the subagent's last agent-role message inline.
      const logger = createChatLogger(chatId, input.subagentId);
      const lastLogMessage = await logger.findLastMessage((m) => m.role === 'agent');
      let outputContent: string | undefined;
      if (lastLogMessage && 'content' in lastLogMessage) {
        outputContent = lastLogMessage.content;
      }
      return { status: 'completed' as const, output: outputContent };
    }
    // 'failed' or 'rejected'
    return { status: record.state, output: undefined };
  });

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
        // 'active' tracker == 'running' delegation. Future approval-gated
        // pending records aren't blocking yet (Ticket 4 wires that in).
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
