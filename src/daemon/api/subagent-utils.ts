import { randomUUID } from 'node:crypto';
import { readChatSettings } from '../../shared/workspace.js';
import { executeDirectMessage, applyRouterStateUpdates } from '../message.js';
import { executeRouterPipeline, resolveRouters } from '../routers.js';
import type { RouterState } from './../routers/types.js';
import { createChatLogger } from '../agent/chat-logger.js';
import { taskScheduler } from '../agent/task-scheduler.js';
import { decrementSubagent } from '../agent/turn-registry.js';
import { delegationManager } from '../delegation-manager.js';

// Walk the delegation parent chain to compute spawn depth. Today's
// MAX_SUBAGENT_DEPTH guard relies on this — depth 0 is the root agent,
// depth 1 a direct child, etc. Replaces the legacy walk over
// `ChatSettings.subagents`.
export async function getSubagentDepth(
  chatId: string,
  parentId: string | undefined
): Promise<number> {
  let depth = 0;
  let currentParentId = parentId;
  // Defensive cycle guard: if a corrupted record cycles back on itself we
  // still terminate. Use depth as the iteration cap.
  while (currentParentId && depth < 100) {
    depth++;
    const record = await delegationManager.get(currentParentId, chatId);
    if (!record || record.kind !== 'subagent') break;
    currentParentId = record.parentId;
  }
  return depth;
}

/**
 * Executes a subagent. Callers MUST have already called `incrementSubagent`
 * for the parent's turn synchronously before any `await` — this function's
 * `finally` block decrements, and we need the caller to increment earlier
 * so that a sibling's completing task cannot decrement the parent's counter
 * to zero (firing `turnEnded`) before this call's task is enqueued.
 */
export async function executeSubagent(
  chatId: string,
  subagentId: string,
  agentId: string,
  sessionId: string,
  prompt: string,
  isAsync: boolean | undefined,
  parentTokenPayload: {
    agentId?: string;
    subagentId?: string;
    sessionId?: string;
    turnId?: string;
  },
  workspaceRoot: string
) {
  const parentTurnId = parentTokenPayload?.turnId;
  try {
    try {
      const settings = (await readChatSettings(chatId)) || {};
      const routers = settings.routers ?? [];
      const resolvedRouters = resolveRouters(routers, false);

      let routerState: RouterState = {
        messageId: randomUUID(),
        message: prompt,
        chatId,
        agentId,
        sessionId,
        subagentId,
        env: {},
      };

      const initialState = { ...routerState };
      routerState = await executeRouterPipeline(routerState, resolvedRouters);

      await applyRouterStateUpdates(
        chatId,
        workspaceRoot,
        routerState,
        settings,
        initialState.agentId
      );

      await executeDirectMessage(
        chatId,
        routerState,
        undefined, // settings
        workspaceRoot,
        false, // noWait
        undefined, // userMessageContent
        subagentId, // subagentId
        undefined, // systemEvent
        undefined, // displayRole
        parentTurnId // parentTurnId — inherit from parent agent's turn
      );

      if (taskScheduler.hasTasks(sessionId)) {
        return;
      }

      // Terminal: subagent finished its turn. Mark the delegation completed.
      // Guard against races where `subagentStop` flipped us to 'failed' first.
      // `wasCovered` is true when an unfired observer (sync waiter or
      // subscription) was watching this id — in that case the manager owns
      // the wakeup and we suppress the per-id `<notification>` below (Ticket
      // 5 / spec §5.2 notify-suppression rule).
      const current = await delegationManager.get(subagentId, chatId);
      let wasCovered = false;
      if (current && current.state === 'running') {
        const outcome = await delegationManager.markResolved(subagentId, { state: 'completed' });
        wasCovered = outcome.wasCovered;
      }

      const logger = createChatLogger(chatId, subagentId, sessionId, parentTurnId);

      // Emit debug message to keep legacy `subagent_status` consumers happy
      // (the chat log surfaces this in tail output). Ticket 5's wait-core
      // listens on DAEMON_EVENT_DELEGATION_RESOLVED instead.
      await logger.logSubagentStatus({ subagentId, status: 'completed' });

      if (isAsync && !wasCovered) {
        const lastLogMessage = await logger.findLastMessage(
          (m) => m.role === 'agent' || m.displayRole === 'agent'
        );
        let outputContent = '';
        if (lastLogMessage && 'content' in lastLogMessage) {
          outputContent = `\n\n<subagent_output>\n${lastLogMessage.content}\n</subagent_output>`;
        }

        // TODO: We need to overhaul the log system in general, and should not try to do it in this PR.
        // Currently, if the parent is the root agent, this notification is logged as a normal user message
        // and appears in the chat UI, violating the PRD requirement to hide orchestration.
        await executeDirectMessage(
          chatId,
          {
            messageId: randomUUID(),
            message: `<notification>Subagent ${subagentId} completed.</notification>${outputContent}`,
            chatId,
            agentId: parentTokenPayload?.agentId || 'default',
            ...(parentTokenPayload?.subagentId
              ? { subagentId: parentTokenPayload.subagentId }
              : {}),
            sessionId: parentTokenPayload?.sessionId || 'default',
            env: {},
          },
          undefined,
          workspaceRoot,
          true,
          undefined,
          parentTokenPayload?.subagentId,
          'subagent_update',
          undefined,
          parentTurnId
        );
      }
    } catch {
      // TODO: Wrap this in a safe try-catch to prevent unhandled promise rejections crashing the daemon if disk errors occur
      const current = await delegationManager.get(subagentId, chatId);
      if (current && current.state === 'running') {
        await delegationManager.markResolved(subagentId, {
          state: 'failed',
          reason: 'subagent execution threw',
        });
      }
      const logger = createChatLogger(chatId, subagentId, sessionId, parentTurnId);
      await logger.logSubagentStatus({ subagentId, status: 'failed' });
    }
  } finally {
    decrementSubagent(parentTurnId);
  }
}
