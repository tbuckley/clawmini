import { randomUUID } from 'node:crypto';
import { readChatSettings } from '../../shared/workspace.js';
import { executeDirectMessage, applyRouterStateUpdates } from '../message.js';
import { executeRouterPipeline, resolveRouters } from '../routers.js';
import type { RouterState } from '../routers/types.js';
import { createChatLogger } from '../agent/chat-logger.js';
import { taskScheduler } from '../agent/task-scheduler.js';
import { decrementSubagent } from '../agent/turn-registry.js';
import { DelegationManager } from '../delegation-manager.js';
import { DelegationStore } from '../delegation-store.js';

export async function checkSubagentStatus(
  chatId: string,
  subagentId: string,
  callerSubagentId: string | undefined
) {
  const store = new DelegationStore();
  const manager = new DelegationManager(store);

  let sub;
  try {
    sub = await manager.assertVisibleTo(chatId, subagentId, callerSubagentId);
  } catch {
    return null; // Not found or forbidden
  }

  if (sub.state === 'completed' || sub.state === 'failed') {
    let outputContent: string | undefined;
    if (sub.state === 'completed') {
      const logger = createChatLogger(chatId, subagentId);
      const lastLogMessage = await logger.findLastMessage((m) => m.role === 'agent');
      if (lastLogMessage && 'content' in lastLogMessage) {
        outputContent = lastLogMessage.content;
      }
    }
    return { status: sub.state, output: outputContent };
  }
  return null;
}

import { on } from 'node:events';
import { daemonEvents, DAEMON_EVENT_MESSAGE_APPENDED } from '../events.js';

export async function waitForSubagentStatus(
  chatId: string,
  subagentId: string,
  callerSubagentId: string | undefined,
  signal?: AbortSignal
) {
  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), 60000);

  const onAbort = () => {
    clearTimeout(timeout);
    ac.abort();
  };
  if (signal) {
    signal.addEventListener('abort', onAbort);
  }

  const eventIterator = on(daemonEvents, DAEMON_EVENT_MESSAGE_APPENDED, {
    signal: ac.signal,
  });

  try {
    const initialStatus = await checkSubagentStatus(chatId, subagentId, callerSubagentId);
    if (initialStatus) {
      clearTimeout(timeout);
      if (signal) signal.removeEventListener('abort', onAbort);
      return initialStatus;
    }

    for await (const [event] of eventIterator) {
      if (event.chatId === chatId && event.message?.subagentId === subagentId) {
        const msg = event.message;
        if (msg.role === 'subagent_status') {
          const status = await checkSubagentStatus(chatId, subagentId, callerSubagentId);
          if (status) {
            clearTimeout(timeout);
            if (signal) signal.removeEventListener('abort', onAbort);
            return status;
          }
        }
      }
    }
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'name' in err && err.name === 'AbortError') {
      return { status: 'active' as const, output: undefined };
    }
    throw err;
  } finally {
    clearTimeout(timeout);
    if (signal) signal.removeEventListener('abort', onAbort);
    ac.abort();
  }

  return { status: 'active' as const, output: undefined };
}
export async function getSubagentDepth(
  chatId: string,
  parentId: string | undefined
): Promise<number> {
  const store = new DelegationStore();
  const manager = new DelegationManager(store);
  let depth = 0;
  let currentParentId = parentId;
  while (currentParentId) {
    const delegation = await manager.get(chatId, currentParentId);
    if (!delegation) break;
    depth++;
    currentParentId = delegation.parentId;
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

      // Update status
      const store = new DelegationStore();
      const manager = new DelegationManager(store);
      await manager.markResolved(chatId, subagentId, 'completed');

      const logger = createChatLogger(chatId, subagentId, sessionId, parentTurnId);

      // Emit debug message to wake up waiters
      await logger.logSubagentStatus({ subagentId, status: 'completed' });

      if (isAsync) {
        const lastLogMessage = await logger.findLastMessage(
          (m) => m.role === 'agent' || m.displayRole === 'agent'
        );
        let outputContent = '';
        if (lastLogMessage && 'content' in lastLogMessage) {
          outputContent = `\n\n<subagent_output>\n${lastLogMessage.content}\n</subagent_output>`;
        }

        console.log(
          'Notifying parent',
          chatId,
          parentTokenPayload?.agentId,
          parentTokenPayload?.subagentId
        );
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
      const store = new DelegationStore();
      const manager = new DelegationManager(store);
      await manager.markResolved(chatId, subagentId, 'failed').catch(() => {});
      const logger = createChatLogger(chatId, subagentId, sessionId, parentTurnId);
      await logger.logSubagentStatus({ subagentId, status: 'failed' });
    }
  } finally {
    decrementSubagent(parentTurnId);
  }
}
