import { randomUUID } from 'node:crypto';
import { updateChatSettings } from '../../shared/workspace.js';
import { executeDirectMessage } from '../message.js';
import { createChatLogger } from '../agent/chat-logger.js';
import type { ChatSettings } from '../../shared/config.js';

export function getSubagentDepth(settings: ChatSettings, parentId: string | undefined): number {
  let depth = 0;
  let currentParentId = parentId;
  while (currentParentId && settings.subagents?.[currentParentId]) {
    depth++;
    currentParentId = settings.subagents[currentParentId]?.parentId;
  }
  return depth;
}

export async function executeSubagent(
  chatId: string,
  subagentId: string,
  agentId: string,
  sessionId: string,
  prompt: string,
  isAsync: boolean | undefined,
  parentTokenPayload: { agentId?: string; subagentId?: string; sessionId?: string },
  workspaceRoot: string
) {
  try {
    await executeDirectMessage(
      chatId,
      {
        messageId: randomUUID(),
        message: prompt,
        chatId,
        agentId,
        sessionId,
        env: {},
      },
      undefined, // settings
      workspaceRoot,
      false, // noWait
      undefined, // userMessageContent
      subagentId // subagentId
    );

    // Update status
    await updateChatSettings(chatId, (finalSettings) => {
      if (finalSettings.subagents?.[subagentId]) {
        finalSettings.subagents[subagentId]!.status = 'completed';
      }
      return finalSettings;
    });

    const logger = createChatLogger(chatId, subagentId);

    // Emit debug message to wake up waiters
    await logger.logSystemEvent({ content: 'Subagent completed', level: 'debug' });

    if (isAsync) {
      const lastLogMessage = await logger.findLastMessage(
        (m) => m.role === 'log' && m.command !== 'retry-delay' && m.source !== 'router'
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
      await executeDirectMessage(
        chatId,
        {
          messageId: randomUUID(),
          message: `<notification>Subagent ${subagentId} completed.</notification>${outputContent}`,
          chatId,
          agentId: parentTokenPayload?.agentId || 'default',
          ...(parentTokenPayload?.subagentId ? { subagentId: parentTokenPayload.subagentId } : {}),
          sessionId: parentTokenPayload?.sessionId || 'default',
          env: {},
        },
        undefined,
        workspaceRoot,
        true // noWait
      );
    }
  } catch {
    await updateChatSettings(chatId, (errSettings) => {
      if (errSettings.subagents?.[subagentId]) {
        errSettings.subagents[subagentId]!.status = 'failed';
      }
      return errSettings;
    });
    const logger = createChatLogger(chatId, subagentId);
    await logger.logSystemEvent({ content: 'Subagent failed', level: 'debug' });
  }
}
