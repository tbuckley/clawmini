import { randomUUID } from 'node:crypto';
import {
  daemonEvents,
  DAEMON_EVENT_DELEGATION_SUBSCRIPTION_FIRED,
  type DelegationSubscriptionFiredEvent,
} from './events.js';
import { executeDirectMessage } from './message.js';
import { getWorkspaceRoot } from '../shared/workspace.js';

daemonEvents.on(
  DAEMON_EVENT_DELEGATION_SUBSCRIPTION_FIRED,
  async (event: DelegationSubscriptionFiredEvent) => {
    try {
      const workspaceRoot = getWorkspaceRoot(process.cwd());
      const idsString = event.resolvedIds.join(', ');

      await executeDirectMessage(
        event.chatId,
        {
          messageId: randomUUID(),
          message: `<notification>Delegation wait condition met for: ${idsString}.</notification>`,
          chatId: event.chatId,
          agentId: event.callerAgentId || 'default',
          ...(event.callerSubagentId ? { subagentId: event.callerSubagentId } : {}),
          sessionId: event.callerSessionId || 'default',
          env: {},
        },
        undefined,
        workspaceRoot,
        true, // noWait
        undefined,
        event.callerSubagentId,
        'subagent_update',
        undefined,
        event.callerTurnId
      );
    } catch (err) {
      console.error('Failed to notify agent of delegation wait completion:', err);
    }
  }
);
