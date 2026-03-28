import { executeSubagent, waitForPolicyRequest } from './subagent-utils.js';
import { updateChatSettings } from '../../shared/workspace.js';

export async function handleSubagentExecution(
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
    if (!isAsync) {
      await waitForPolicyRequest(policyResult.request.id, workspaceRoot);
      executeSubagent(
        chatId,
        subagentId,
        agentId,
        sessionId,
        prompt,
        isAsync,
        tokenPayload,
        workspaceRoot
      );
    } else {
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
          );
        })
        .catch((_err) => {
          updateChatSettings(chatId, (settings) => {
            if (settings.subagents?.[subagentId]) {
              settings.subagents[subagentId].status = 'failed';
            }
            return settings;
          }).catch(console.error);
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
    );
  }
}
