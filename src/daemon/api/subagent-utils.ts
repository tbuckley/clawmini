import { randomUUID } from 'node:crypto';

import { TRPCError } from '@trpc/server';
import path from 'node:path';
import { readPolicies, getClawminiDir } from '../../shared/workspace.js';
import { RequestStore } from '../request-store.js';
import { PolicyRequestService } from '../policy-request-service.js';
import { executeRequest, generateRequestPreview } from '../policy-utils.js';
import { appendMessage } from '../chats.js';
import type { PolicyRequestMessage } from '../chats.js';
import type { PolicyRequest } from '../../shared/policies.js';

import { updateChatSettings, getActiveEnvironmentName } from '../../shared/workspace.js';
import { executeDirectMessage } from '../message.js';
import { createChatLogger } from '../agent/chat-logger.js';
import type { ChatSettings } from '../../shared/config.js';
import { taskScheduler } from '../agent/task-scheduler.js';
import { resolveAgentDir } from './router-utils.js';
import { daemonEvents, DAEMON_EVENT_MESSAGE_APPENDED } from '../events.js';

export async function waitForPolicyRequest(
  requestId: string,
  workspaceRoot: string
): Promise<void> {
  const store = new RequestStore(workspaceRoot);

  return new Promise((resolve, reject) => {
    let resolved = false;
    const cleanup = () => {
      daemonEvents.removeListener(DAEMON_EVENT_MESSAGE_APPENDED, onMessage);
    };

    const checkState = async () => {
      if (resolved) return;
      try {
        const req = await store.load(requestId);
        if (!req) {
          resolved = true;
          cleanup();
          reject(new TRPCError({ code: 'NOT_FOUND', message: 'Policy request not found' }));
          return;
        }
        if (req.state === 'Approved') {
          resolved = true;
          cleanup();
          resolve();
        } else if (req.state === 'Rejected') {
          resolved = true;
          cleanup();
          reject(new TRPCError({ code: 'FORBIDDEN', message: 'Policy request rejected' }));
        }
      } catch (e) {
        resolved = true;
        cleanup();
        reject(e);
      }
    };

    const onMessage = async (data: { message?: { role?: string; event?: string } }) => {
      if (resolved) return;
      const message = data?.message;
      if (
        message &&
        message.role === 'system' &&
        (message.event === 'policy_approved' || message.event === 'policy_rejected')
      ) {
        await checkState();
      }
    };

    daemonEvents.on(DAEMON_EVENT_MESSAGE_APPENDED, onMessage);
    checkState().catch((e) => {
      resolved = true;
      cleanup();
      reject(e);
    });
  });
}

export async function resolveSubagentEnvironments(
  sourceAgentId: string,
  targetAgentId: string,
  workspaceRoot: string
): Promise<{ sourceEnv: string; targetEnv: string }> {
  const sourceDir = await resolveAgentDir(sourceAgentId, workspaceRoot);
  const targetDir = await resolveAgentDir(targetAgentId, workspaceRoot);

  const sourceEnvRaw = await getActiveEnvironmentName(sourceDir, workspaceRoot);
  const targetEnvRaw = await getActiveEnvironmentName(targetDir, workspaceRoot);

  return {
    sourceEnv: sourceEnvRaw || 'host',
    targetEnv: targetEnvRaw || 'host',
  };
}

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
    await updateChatSettings(chatId, (settings) => {
      if (settings.subagents?.[subagentId]) {
        settings.subagents[subagentId]!.status = 'active';
      }
      return settings;
    });

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

    if (taskScheduler.hasTasks(sessionId)) {
      return;
    }

    // Update status
    await updateChatSettings(chatId, (finalSettings) => {
      if (finalSettings.subagents?.[subagentId]) {
        finalSettings.subagents[subagentId]!.status = 'completed';
      }
      return finalSettings;
    });

    const logger = createChatLogger(chatId, subagentId);

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
          ...(parentTokenPayload?.subagentId ? { subagentId: parentTokenPayload.subagentId } : {}),
          sessionId: parentTokenPayload?.sessionId || 'default',
          env: {},
        },
        undefined,
        workspaceRoot,
        true,
        undefined,
        parentTokenPayload?.subagentId,
        'subagent_update'
      );
    }
  } catch {
    // TODO: Wrap this in a safe try-catch to prevent unhandled promise rejections crashing the daemon if disk errors occur
    await updateChatSettings(chatId, (errSettings) => {
      if (errSettings.subagents?.[subagentId]) {
        errSettings.subagents[subagentId]!.status = 'failed';
      }
      return errSettings;
    });
    const logger = createChatLogger(chatId, subagentId);
    await logger.logSubagentStatus({ subagentId, status: 'failed' });
  }
}

export async function handleSubagentPolicyRequest(
  sourceEnv: string,
  targetEnv: string,
  chatId: string,
  sourceAgentId: string,
  sourceSubagentId: string | undefined,
  action: 'spawn' | 'send',
  targetAgentId: string,
  targetSubagentId: string,
  prompt: string,
  workspaceRoot: string
): Promise<{ request: PolicyRequest; status: 'pending' | 'approved' } | null> {
  if (sourceEnv === targetEnv) {
    return null;
  }

  const commandName = `@clawmini/subagent:${sourceEnv}:${targetEnv}`;
  const args = [action, targetAgentId, targetSubagentId, prompt];

  const config = await readPolicies(workspaceRoot);
  const policy = config?.policies?.[commandName];

  if (!policy) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `Policy not found: ${commandName}`,
    });
  }

  const isAutoApprove = !!policy.autoApprove;

  const snapshotDir = path.join(getClawminiDir(workspaceRoot), 'tmp', 'snapshots');
  const store = new RequestStore(workspaceRoot);
  const agentDir = await resolveAgentDir(sourceAgentId, workspaceRoot);
  const service = new PolicyRequestService(store, agentDir, snapshotDir);

  const request = await service.createRequest(
    commandName,
    args,
    {},
    chatId,
    sourceAgentId,
    isAutoApprove,
    sourceSubagentId
  );

  if (isAutoApprove) {
    const { stdout, stderr, exitCode, commandStr } = await executeRequest(
      request,
      policy,
      workspaceRoot
    );

    request.executionResult = { stdout, stderr, exitCode };
    await store.save(request);

    const logMsg: PolicyRequestMessage = {
      id: randomUUID(),
      messageId: randomUUID(),
      role: 'policy',
      requestId: request.id,
      commandName,
      args,
      status: 'approved',
      content: `[Auto-approved] Policy ${commandName} was executed.\n\nCommand: ${commandStr}\nExit Code: ${exitCode}\n\nStdout:\n${stdout}\n\nStderr:\n${stderr}`,
      timestamp: new Date().toISOString(),
      ...(sourceSubagentId ? { subagentId: sourceSubagentId } : {}),
    };

    await appendMessage(chatId, logMsg);
    return { request, status: 'approved' };
  }

  const previewContent = await generateRequestPreview(request);

  const logMsg: PolicyRequestMessage = {
    id: randomUUID(),
    messageId: randomUUID(),
    role: 'policy',
    requestId: request.id,
    commandName,
    args,
    status: 'pending',
    content: previewContent,
    timestamp: new Date().toISOString(),
    displayRole: 'agent',
    ...(sourceSubagentId ? { subagentId: sourceSubagentId } : {}),
  };

  await appendMessage(chatId, logMsg);
  return { request, status: 'pending' };
}
