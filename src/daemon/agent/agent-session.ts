import type { MaybePromise } from '@trpc/server/unstable-core-do-not-import';
import type { Agent, AgentSessionSettings, Settings } from '../../shared/config.js';
import { getMessageQueue } from '../queue.js';
import { AgentRunner } from './agent-runner.js';
import type { Logger, Message } from './types.js';
import { runCommand } from '../utils/spawn.js';
import { resolveAgentWorkDir } from '../../shared/workspace.js';
import { formatPendingMessages } from './utils.js';
import { createChatLogger } from './chat-logger.js';

export class AgentSession {
  public readonly agentId: string;
  public readonly sessionId: string;
  public readonly chatId: string;
  public readonly settings: Agent;
  public readonly sessionSettings: AgentSessionSettings | null;
  public readonly workspaceRoot: string;
  public readonly globalSettings: Settings | undefined;
  private logger: Logger;

  constructor(config: {
    agentId: string;
    sessionId: string;
    chatId: string;
    settings: Agent;
    sessionSettings: AgentSessionSettings | null;
    workspaceRoot: string;
    globalSettings: Settings | undefined;
  }) {
    this.agentId = config.agentId;
    this.sessionId = config.sessionId;
    this.chatId = config.chatId;
    this.settings = config.settings;
    this.sessionSettings = config.sessionSettings;
    this.workspaceRoot = config.workspaceRoot;
    this.globalSettings = config.globalSettings;

    this.logger = createChatLogger(this.chatId);
  }

  createRunner(): AgentRunner {
    return new AgentRunner(
      this.chatId,
      this.agentId,
      this.sessionId,
      this.settings,
      this.sessionSettings,
      this.workDirectory,
      this.workspaceRoot,
      this.globalSettings,
      this.logger,
      runCommand
    );
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

  interrupt(message: Message): MaybePromise<void> {
    const queue = this.getTaskQueue();

    const isMatchingSession = (p: { sessionId: string }) => p.sessionId === this.sessionId;
    const currentPayload = queue.getCurrentPayload();
    const currentMatches = currentPayload ? isMatchingSession(currentPayload) : false;

    const extracted = queue.extractPending(isMatchingSession);
    queue.abortCurrent(isMatchingSession);
    const payloads = currentMatches && currentPayload ? [currentPayload, ...extracted] : extracted;

    if (payloads.length > 0) {
      // TODO: Figure out how to handle merging payloads when they have different env settings or other config.
      // Currently, we only preserve the text content and drop any specific configuration attached to individual messages.
      const pendingText = formatPendingMessages(payloads.map((p) => p.text));
      message.content = `${pendingText}\n\n<message>\n${message.content}\n</message>`.trim();
    }
    return this.handleMessage(message);
  }

  async handleMessage(message: Message): Promise<void> {
    if (!message.content.trim()) {
      return;
    }

    const queue = this.getTaskQueue();
    await queue.enqueue(
      async (signal) => {
        const runner = this.createRunner();
        const lastLogMsg = await runner.executeWithFallbacks(message, signal);
        if (lastLogMsg) {
          await this.logger.log(lastLogMsg);
        }
      },
      { text: message.content, sessionId: this.sessionId }
    );
  }
}
