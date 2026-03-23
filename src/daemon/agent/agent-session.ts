import type { Agent, AgentSessionSettings, Settings } from '../../shared/config.js';
import { getMessageQueue } from '../queue.js';
import { AgentRunner } from './agent-runner.js';
import type { Logger, Message } from './types.js';
import { runCommand } from '../utils/spawn.js';
import {
  getAgent,
  getWorkspaceRoot,
  readAgentSessionSettings,
  writeAgentSessionSettings,
  readSettings,
  resolveAgentWorkDir,
} from '../../shared/workspace.js';
import { formatPendingMessages } from './utils.js';
import { createChatLogger } from './chat-logger.js';
import { sandboxExecutionContext, type Fallback } from './agent-context.js';
import { applyEnvOverrides, getActiveEnvKeys } from '../../shared/utils/env.js';
import { getApiContext, generateToken } from '../auth.js';

export class AgentSession {
  public readonly agentId: string;
  public readonly sessionId: string;
  public readonly chatId: string;
  public readonly settings: Agent;
  public sessionSettings: AgentSessionSettings | null;
  public readonly workspaceRoot: string;
  public readonly globalSettings: Settings | undefined;
  public readonly logger: Logger;

  constructor(config: {
    agentId: string;
    sessionId: string;
    chatId: string;
    settings: Agent;
    sessionSettings: AgentSessionSettings | null;
    workspaceRoot: string;
    globalSettings: Settings | undefined;
    logger?: Logger;
  }) {
    this.agentId = config.agentId;
    this.sessionId = config.sessionId;
    this.chatId = config.chatId;
    this.settings = config.settings;
    this.sessionSettings = config.sessionSettings;
    this.workspaceRoot = config.workspaceRoot;
    this.globalSettings = config.globalSettings;

    this.logger = config.logger ?? createChatLogger(this.chatId);
  }

  get isNewSession(): boolean {
    return !this.sessionSettings;
  }

  async buildExecutionContext(
    messageContent: string,
    routerEnv: Record<string, string>,
    fallback?: Fallback
  ): Promise<{ command: string; env: Record<string, string>; currentAgent: Agent } | null> {
    const currentAgent: Agent = {
      ...this.settings,
      commands: {
        ...this.settings.commands,
        ...(fallback?.commands || {}),
      },
      env: {
        ...this.settings.env,
        ...(fallback?.env || {}),
      },
    };

    let initialCommand = currentAgent.commands?.new ?? '';
    const env = {
      ...process.env,
      CLAW_CLI_MESSAGE: messageContent,
    } as Record<string, string>;

    applyEnvOverrides(env, currentAgent.env);

    if (!this.isNewSession && currentAgent.commands?.append) {
      initialCommand = currentAgent.commands.append;
      applyEnvOverrides(env, this.sessionSettings?.env);
    }

    if (!initialCommand) {
      return null;
    }

    const agentSpecificEnvKeys = getActiveEnvKeys(
      currentAgent.env,
      !this.isNewSession ? this.sessionSettings?.env : undefined
    );
    agentSpecificEnvKeys.add('CLAW_CLI_MESSAGE');

    Object.assign(env, routerEnv);
    Object.keys(routerEnv).forEach((k) => agentSpecificEnvKeys.add(k));

    const apiCtx = getApiContext(this.globalSettings);
    if (apiCtx) {
      const proxyUrl = apiCtx.proxy_host
        ? `${apiCtx.proxy_host}:${apiCtx.port}`
        : `http://${apiCtx.host}:${apiCtx.port}`;
      env['CLAW_API_URL'] = proxyUrl;
      agentSpecificEnvKeys.add('CLAW_API_URL');

      const token = generateToken({
        chatId: this.chatId,
        agentId: this.agentId,
        sessionId: this.sessionId,
        timestamp: Date.now(),
      });
      env['CLAW_API_TOKEN'] = token;
      agentSpecificEnvKeys.add('CLAW_API_TOKEN');
    }

    let command = initialCommand;
    command = await sandboxExecutionContext(
      command,
      env,
      agentSpecificEnvKeys,
      this.workDirectory,
      this.workspaceRoot
    );

    return { command, env, currentAgent };
  }

  createRunner(): AgentRunner {
    return new AgentRunner(this, runCommand);
  }

  get workDirectory(): string {
    return resolveAgentWorkDir(this.agentId, this.settings.directory, this.workspaceRoot);
  }

  private getTaskQueue() {
    return getMessageQueue(this.workDirectory);
  }

  stop() {
    const queue = this.getTaskQueue();
    // FIXME: Only stop tasks for this agent session
    queue.abortCurrent();
    queue.clear();
  }

  interrupt(message: Message): Message {
    const queue = this.getTaskQueue();

    const isMatchingSession = (p: { sessionId: string }) => p.sessionId === this.sessionId;
    const payloads = queue.interrupt(isMatchingSession);

    if (payloads.length > 0) {
      // TODO: Figure out how to handle merging payloads when they have different env settings or other config.
      // Currently, we only preserve the text content and drop any specific configuration attached to individual messages.
      const pendingText = formatPendingMessages(payloads.map((p) => p.text));
      return {
        ...message,
        content: `${pendingText}\n\n<message>\n${message.content}\n</message>`.trim(),
      };
    }
    return message;
  }

  async handleMessage(message: Message): Promise<void> {
    if (!message.content.trim()) {
      return;
    }

    const queue = this.getTaskQueue();
    await queue.enqueue(
      async (signal) => {
        // Refresh sessionSettings immediately before execution
        this.sessionSettings =
          (await readAgentSessionSettings(this.agentId, this.sessionId, this.workspaceRoot)) ??
          null;

        const runner = this.createRunner();
        const result = await runner.executeWithFallbacks(message, signal);
        if (!result) {
          // TODO: throw an error? Log an error?
          return;
        }

        if (result.extractedSessionId) {
          await writeAgentSessionSettings(
            this.agentId,
            this.sessionId,
            { env: { SESSION_ID: result.extractedSessionId } },
            this.workspaceRoot
          );
        }

        await this.logger.logCommandResult(result);
      },
      { text: message.content, sessionId: this.sessionId }
    );
  }
}

export async function createAgentSession(options: {
  chatId: string;
  agentId: string;
  sessionId: string;
  cwd: string;
  settings?: Settings | undefined;
  logger?: Logger;
}) {
  // TODO: make it so that readSettings returns Settings|undefined
  const settings = options.settings ?? (await readSettings(options.cwd)) ?? undefined;
  const mergedAgent = await resolveMergedAgent(options.agentId, settings, options.cwd);
  const workspaceRoot = getWorkspaceRoot(options.cwd);

  return new AgentSession({
    agentId: options.agentId,
    sessionId: options.sessionId,
    chatId: options.chatId,
    settings: mergedAgent,
    sessionSettings: null, // Resolves lazily at execution time
    workspaceRoot,
    globalSettings: settings,
    ...(options.logger ? { logger: options.logger } : {}),
  });
}

async function resolveMergedAgent(
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
