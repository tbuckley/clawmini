import { TRPCError } from '@trpc/server';
import { executeSubagent, waitForPolicyRequest } from './subagent-utils.js';
import { updateChatSettings } from '../../shared/workspace.js';

export function handleSubagentExecution(
  policyResult: { status: 'pending' | 'approved'; request: { id: string } } | null | undefined,
  isAsync: boolean | undefined,
  chatId: string,
  subagentId: string,
  agentId: string,
  sessionId: string,
  prompt: string,
  tokenPayload: { agentId?: string; subagentId?: string; sessionId?: string },
  workspaceRoot: string
) {
  if (policyResult?.status === 'pending') {
    waitForPolicyRequest(policyResult.request.id, workspaceRoot)
      .then(() => {
        executeSubagent(
          chatId,
          subagentId,
          agentId,
          sessionId,
          prompt,
          isAsync,
          tokenPayload,
          workspaceRoot
        ).catch(console.error);
      })
      .catch((_err) => {
        updateChatSettings(chatId, (settings) => {
          if (settings.subagents?.[subagentId]) {
            settings.subagents[subagentId].status = 'failed';
          }
          return settings;
        }).catch(console.error);
      });

    if (!isAsync) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message:
          'Subagent execution is blocked pending policy approval. Synchronous execution is not supported while pending.',
      });
    }
  } else {
    executeSubagent(
      chatId,
      subagentId,
      agentId,
      sessionId,
      prompt,
      isAsync,
      tokenPayload,
      workspaceRoot
    ).catch(console.error);
  }
}
