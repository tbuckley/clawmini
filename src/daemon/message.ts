import { type UserMessage, type CommandLogMessage } from './chats.js';
import { executeRouterPipeline } from './routers.js';
import type { RouterState } from './routers/types.js';
import { type Settings } from '../shared/config.js';
import { readChatSettings, writeChatSettings } from '../shared/workspace.js';
import { cronManager } from './cron.js';
import { type Message } from './agent/types.js';
import { createAgentSession } from './agent/agent-session.js';
import { createChatLogger } from './agent/chat-logger.js';

export { calculateDelay, type RunCommandResult, type RunCommandFn } from './agent/agent-runner.js';

export async function executeDirectMessage(
  chatId: string,
  state: RouterState,
  settings: Settings | undefined,
  cwd: string,
  noWait: boolean = false,
  userMessageContent?: string
) {
  const logger = createChatLogger(chatId);

  const userMsg: UserMessage = {
    id: state.messageId,
    role: 'user',
    content: userMessageContent ?? state.message,
    timestamp: new Date().toISOString(),
  };
  await logger.log(userMsg);

  if (state.reply) {
    const routerLogMsg: CommandLogMessage = {
      id: crypto.randomUUID(),
      messageId: userMsg.id,
      role: 'log',
      source: 'router',
      content: state.reply,
      stderr: '',
      timestamp: new Date().toISOString(),
      command: 'router',
      cwd,
      exitCode: 0,
      ...(state.reply.includes('NO_REPLY_NECESSARY') ? { level: 'verbose' as const } : {}),
    };
    await logger.log(routerLogMsg);
  }

  if (!state.message.trim() && state.action !== 'stop' && state.action !== 'interrupt') {
    return;
  }

  // Load the agent
  const agentSession = await createAgentSession({
    chatId,
    agentId: state.agentId,
    sessionId: state.sessionId,
    cwd,
    settings,
  });
  const message: Message = {
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
    agentSession.interrupt(message);
    return;
  }

  // Process message
  const taskPromise = agentSession.handleMessage(message);

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
  cwd: string = process.cwd(),
  overrideAgentId?: string,
  overrideSessionId?: string
): Promise<RouterState> {
  const chatSettings = (await readChatSettings(chatId, cwd)) ?? {};
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
    cwd,
    overrideAgentId,
    sessionId
  );
  const initialAgent = initialState.agentId;

  const routers = chatSettings.routers ?? settings?.routers ?? [];

  const finalState = await executeRouterPipeline(initialState, routers);

  const finalMessage = finalState.message;
  const finalAgentId = finalState.agentId;
  const finalSessionId = finalState.sessionId ?? crypto.randomUUID();
  const routerEnv = finalState.env ?? {};

  const currentAgentId = finalAgentId ?? chatSettings.defaultAgent ?? 'default';

  let settingsChanged = false;
  if (finalAgentId && finalAgentId !== initialAgent) {
    chatSettings.defaultAgent = finalAgentId;
    settingsChanged = true;
  }

  if (finalSessionId && chatSettings.sessions?.[currentAgentId] !== finalSessionId) {
    chatSettings.sessions = chatSettings.sessions || {};
    chatSettings.sessions[currentAgentId] = finalSessionId;
    settingsChanged = true;
  }

  if (finalState.nextSessionId) {
    chatSettings.sessions = chatSettings.sessions || {};
    chatSettings.sessions[currentAgentId] = finalState.nextSessionId;
    settingsChanged = true;
  }

  if (finalState.jobs) {
    chatSettings.jobs = chatSettings.jobs || [];

    if (finalState.jobs.remove?.length) {
      const removeSet = new Set(finalState.jobs.remove);
      for (const jobId of finalState.jobs.remove) {
        cronManager.unscheduleJob(chatId, jobId);
      }
      chatSettings.jobs = chatSettings.jobs.filter((j) => !removeSet.has(j.id));
      settingsChanged = true;
    }

    if (finalState.jobs.add?.length) {
      const addMap = new Map(finalState.jobs.add.map((job) => [job.id, job]));
      for (const job of finalState.jobs.add) {
        cronManager.scheduleJob(chatId, job);
      }
      chatSettings.jobs = chatSettings.jobs.filter((j) => !addMap.has(j.id));
      chatSettings.jobs.push(...finalState.jobs.add);
      settingsChanged = true;
    }
  }

  if (settingsChanged) {
    await writeChatSettings(chatId, chatSettings, cwd);
  }

  const directState: RouterState = {
    messageId: finalState.messageId,
    message: finalMessage,
    chatId,
    env: routerEnv,
  };
  if (finalAgentId !== undefined) directState.agentId = finalAgentId;
  if (finalSessionId !== undefined) directState.sessionId = finalSessionId;
  if (finalState.reply !== undefined) directState.reply = finalState.reply;
  if (finalState.action !== undefined) directState.action = finalState.action;

  await executeDirectMessage(chatId, directState, settings, cwd, noWait, message);
}
