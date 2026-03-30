import { executeRouterPipeline, resolveRouters } from './routers.js';
import type { RouterState } from './routers/types.js';
import { type ChatSettings, type Settings } from '../shared/config.js';
import { readChatSettings, writeChatSettings } from '../shared/workspace.js';
import { cronManager } from './cron.js';
import type { Message } from './agent/types.js';
import { createAgentSession } from './agent/agent-session.js';
import { createChatLogger } from './agent/chat-logger.js';

export { calculateDelay } from './agent/agent-runner.js';

export async function executeDirectMessage(
  chatId: string,
  state: RouterState,
  settings: Settings | undefined,
  cwd: string,
  noWait: boolean = false,
  userMessageContent?: string,
  subagentId?: string,
  systemEvent?:
    | 'cron'
    | 'policy_approved'
    | 'policy_rejected'
    | 'subagent_update'
    | 'router'
    | 'other',
  displayRole?: 'user' | 'agent'
) {
  const logger = createChatLogger(chatId, subagentId);

  let msgId: string;
  if (systemEvent) {
    const sysMsg = await logger.logSystemMessage({
      content: userMessageContent ?? state.message,
      event: systemEvent,
      messageId: state.messageId,
      ...(displayRole ? { displayRole } : {}),
    });
    msgId = sysMsg.id;
  } else {
    const userMsg = await logger.logUserMessage(userMessageContent ?? state.message);
    msgId = userMsg.id;
  }

  if (state.reply) {
    await logger.logAutomaticReply({ messageId: msgId, content: state.reply });
  }

  if (!state.message.trim() && state.action !== 'stop' && state.action !== 'interrupt') {
    return;
  }

  // Load the agent
  const agentSession = await createAgentSession({
    chatId,
    agentId: state.agentId || 'default',
    sessionId: state.sessionId || 'default',
    ...(subagentId ? { subagentId } : {}),
    cwd,
    settings,
    logger,
  });
  let finalMessage: Message = {
    id: state.messageId,
    content: state.message,
    env: state.env ?? {},
  };

  // Process actions
  if (state.action === 'stop') {
    agentSession.stop();
    return;
  }
  if (state.action === 'interrupt') {
    finalMessage = agentSession.interrupt(finalMessage);
  }

  // Process message
  const taskPromise = agentSession.handleMessage(finalMessage);

  if (!noWait) {
    try {
      await taskPromise;
    } catch (err) {
      if (!(err instanceof Error && err.name === 'AbortError')) {
        throw err;
      }
    }
  } else {
    taskPromise.catch((err) => {
      if (err.name !== 'AbortError') {
        console.error('Task execution error:', err);
      }
    });
  }
}

export async function getInitialRouterState(
  chatId: string,
  message: string,
  chatSettings: Partial<ChatSettings>,
  overrideAgentId?: string,
  overrideSessionId?: string
): Promise<RouterState> {
  const agentId = overrideAgentId ?? chatSettings.defaultAgent ?? 'default';
  const sessionId = overrideSessionId ?? chatSettings.sessions?.[agentId] ?? 'default';
  const messageId = crypto.randomUUID();

  return {
    messageId,
    message,
    chatId,
    agentId,
    sessionId,
    env: {},
  };
}

export async function handleUserMessage(
  chatId: string,
  message: string,
  settings: Settings | undefined,
  cwd: string = process.cwd(),
  noWait: boolean = false,
  sessionId?: string,
  overrideAgentId?: string
): Promise<void> {
  const chatSettings = (await readChatSettings(chatId, cwd)) ?? {};

  if (overrideAgentId && chatSettings.defaultAgent !== overrideAgentId) {
    chatSettings.defaultAgent = overrideAgentId;
    await writeChatSettings(chatId, chatSettings, cwd);
  }

  const initialState = await getInitialRouterState(
    chatId,
    message,
    chatSettings,
    overrideAgentId,
    sessionId
  );

  const routers = chatSettings.routers ?? settings?.routers ?? [];
  const resolvedRouters = resolveRouters(routers, true);
  const finalState = await executeRouterPipeline(initialState, resolvedRouters);

  await applyRouterStateUpdates(chatId, cwd, finalState, chatSettings, initialState.agentId);

  await executeDirectMessage(chatId, finalState, settings, cwd, noWait, message);
}

export async function applyRouterStateUpdates(
  chatId: string,
  cwd: string,
  finalState: RouterState,
  chatSettings: ChatSettings,
  initialAgent: string | undefined
) {
  const finalAgentId = finalState.agentId;
  const finalSessionId = finalState.sessionId ?? crypto.randomUUID();
  const currentAgentId = finalAgentId ?? chatSettings.defaultAgent ?? 'default';

  let settingsChanged = false;
  if (finalAgentId && finalAgentId !== initialAgent) {
    chatSettings.defaultAgent = finalAgentId;
    settingsChanged = true;
  }

  if (finalState.nextSessionId) {
    chatSettings.sessions = chatSettings.sessions || {};
    const currentActiveSession = chatSettings.sessions[currentAgentId];
    if (!currentActiveSession || currentActiveSession === finalSessionId) {
      chatSettings.sessions[currentAgentId] = finalState.nextSessionId;
      settingsChanged = true;
    }
  }

  if (finalState.jobs) {
    chatSettings.jobs = chatSettings.jobs || [];

    if (finalState.jobs.remove?.length) {
      const removeSet = new Set(finalState.jobs.remove);
      for (const jobId of finalState.jobs.remove) {
        cronManager.unscheduleJob(chatId, jobId);
      }
      chatSettings.jobs = chatSettings.jobs.filter((job) => !removeSet.has(job.id));
      settingsChanged = true;
    }

    if (finalState.jobs.add?.length) {
      const addMap = new Map(finalState.jobs.add.map((job) => [job.id, job]));
      for (const job of finalState.jobs.add) {
        cronManager.scheduleJob(chatId, job);
      }
      chatSettings.jobs = chatSettings.jobs.filter((job) => !addMap.has(job.id));
      chatSettings.jobs.push(...finalState.jobs.add);
      settingsChanged = true;
    }
  }

  if (settingsChanged) {
    await writeChatSettings(chatId, chatSettings, cwd);
  }

  // Ensure finalSessionId is set on state so extractDirectState gets it.
  if (finalState.sessionId === undefined) {
    finalState.sessionId = finalSessionId;
  }
  if (finalState.agentId === undefined) {
    finalState.agentId = currentAgentId;
  }
}
