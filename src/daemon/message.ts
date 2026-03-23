/* eslint-disable max-lines */
import {
  appendMessage,
  type UserMessage,
  type CommandLogMessage,
  type ChatMessage,
} from './chats.js';
import { getMessageQueue } from './queue.js';
import { executeRouterPipeline } from './routers.js';
import type { RouterState } from './routers/types.js';
import { type Settings, type Agent, type AgentSessionSettings } from '../shared/config.js';
import {
  readChatSettings,
  writeChatSettings,
  readAgentSessionSettings,
  getAgent,
  getWorkspaceRoot,
  resolveAgentWorkDir,
} from '../shared/workspace.js';
import { cronManager } from './cron.js';
import { AgentRunner, type Logger } from './agent-runner.js';
import { runCommand } from './utils/spawn.js';

export { calculateDelay, type RunCommandResult, type RunCommandFn } from './agent-runner.js';

export function formatPendingMessages(payloads: string[]): string {
  return payloads.map((text) => `<message>\n${text}\n</message>`).join('\n\n');
}

async function resolveSessionState(
  chatId: string,
  cwd: string,
  sessionId?: string,
  overrideAgentId?: string
) {
  const chatSettings = await readChatSettings(chatId, cwd);
  const agentId =
    overrideAgentId ??
    (typeof chatSettings?.defaultAgent === 'string' ? chatSettings.defaultAgent : 'default');

  let targetSessionId = sessionId;
  if (!targetSessionId) {
    const sessions = chatSettings?.sessions || {};
    targetSessionId = sessions[agentId] || 'default';
  }

  const agentSessionSettings = await readAgentSessionSettings(agentId, targetSessionId, cwd);
  const isNewSession = !agentSessionSettings;

  return { chatSettings, agentId, targetSessionId, agentSessionSettings, isNewSession };
}

function createChatLogger(chatId: string) {
  return {
    log: async (msg: ChatMessage) => {
      await appendMessage(chatId, msg);
    },
  };
}

export async function resolveMergedAgent(
  agentId: string,
  settings: Settings | undefined,
  cwd: string
): Promise<Agent> {
  let mergedAgent: Agent = settings?.defaultAgent || {};
  if (agentId !== 'default') {
    try {
      const customAgent = await getAgent(agentId, cwd);
      if (customAgent) {
        mergedAgent = {
          ...mergedAgent,
          ...customAgent,
          commands: { ...mergedAgent.commands, ...customAgent.commands },
          env: { ...mergedAgent.env, ...customAgent.env },
        };
      }
    } catch {
      // Fall back to default if agent not found
    }
  }
  return mergedAgent;
}

export class AgentSession {
  public readonly agentId: string;
  public readonly sessionId: string;
  public readonly chatId: string;
  public readonly settings: Agent;
  public readonly sessionSettings: AgentSessionSettings | null;
  public readonly workspaceRoot: string;

  constructor(config: {
    agentId: string;
    sessionId: string;
    chatId: string;
    settings: Agent;
    sessionSettings: AgentSessionSettings | null;
    workspaceRoot: string;
  }) {
    this.agentId = config.agentId;
    this.sessionId = config.sessionId;
    this.chatId = config.chatId;
    this.settings = config.settings;
    this.sessionSettings = config.sessionSettings;
    this.workspaceRoot = config.workspaceRoot;
  }

  createLogger(): Logger {
    return createChatLogger(this.chatId);
  }
  createRunner(settings: Settings | undefined): AgentRunner {
    return new AgentRunner(
      this.chatId,
      this.agentId,
      this.sessionId,
      this.settings,
      this.sessionSettings,
      this.workDirectory,
      this.workspaceRoot,
      settings,
      this.createLogger(),
      runCommand
    );
  }

  get workDirectory(): string {
    return resolveAgentWorkDir(this.agentId, this.settings.directory, this.workspaceRoot);
  }
}

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
    id: state.messageId ?? crypto.randomUUID(),
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
  const {
    agentId,
    agentSessionSettings,
    targetSessionId: finalSessionId,
  } = await resolveSessionState(chatId, cwd, state.sessionId, state.agentId);
  const mergedAgent = await resolveMergedAgent(agentId, settings, cwd);
  const workspaceRoot = getWorkspaceRoot(cwd);

  const agentSession = new AgentSession({
    agentId,
    sessionId: finalSessionId,
    chatId,
    settings: mergedAgent,
    sessionSettings: agentSessionSettings,
    workspaceRoot,
  });

  // Load the queue
  const queue = getMessageQueue(agentSession.workDirectory);

  // Process actions

  if (state.action === 'stop') {
    queue.abortCurrent();
    queue.clear();
    return;
  }

  if (state.action === 'interrupt') {
    const targetSessionId = state.sessionId || 'default';
    const isMatchingSession = (p: { sessionId: string }) => p.sessionId === targetSessionId;
    const currentPayload = queue.getCurrentPayload();
    const currentMatches = currentPayload ? isMatchingSession(currentPayload) : false;

    const extracted = queue.extractPending(isMatchingSession);
    queue.abortCurrent(isMatchingSession);
    const payloads = currentMatches && currentPayload ? [currentPayload, ...extracted] : extracted;

    if (payloads.length > 0) {
      // TODO: Figure out how to handle merging payloads when they have different env settings or other config.
      // Currently, we only preserve the text content and drop any specific configuration attached to individual messages.
      const pendingText = formatPendingMessages(payloads.map((p) => p.text));
      state.message = `${pendingText}\n\n<message>\n${state.message}\n</message>`.trim();
    }
  }

  if (!state.message.trim()) {
    return;
  }

  const taskPromise = queue.enqueue(
    async (signal) => {
      const runner = agentSession.createRunner(settings);
      const lastLogMsg = await runner.executeWithFallbacks(state, signal);
      if (lastLogMsg) {
        await logger.log(lastLogMsg);
      }
    },
    { text: state.message, sessionId: agentSession.sessionId }
  );

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
