import { emitTyping } from '../events.js';
import type { ExecutionResponse, Message, RunCommandFn } from './types.js';
import { type Fallback } from './agent-context.js';
import { extractMessageContent, extractSessionId } from './agent-extractors.js';
import type { AgentSession } from './agent-session.js';

export function calculateDelay(
  attempt: number,
  baseDelayMs: number,
  isFallback: boolean = false
): number {
  const effectiveAttempt = isFallback ? attempt + 1 : attempt;
  if (effectiveAttempt <= 0) return 0;
  const delay = baseDelayMs * Math.pow(2, effectiveAttempt - 1);
  return Math.min(delay, 15000);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class AgentRunner {
  constructor(
    private readonly session: AgentSession,
    private readonly runCommand: RunCommandFn
  ) {}

  get isNewSession(): boolean {
    return !this.session.sessionSettings;
  }

  private async withTypingIndicator<T>(fn: () => Promise<T>): Promise<T> {
    const interval = setInterval(() => emitTyping(this.session.chatId), 5000);
    try {
      return await fn();
    } finally {
      clearInterval(interval);
    }
  }

  private *getExecutionAttempts() {
    const fallbacks = this.session.settings.fallbacks || [];
    const executionConfigs = [
      { fallback: undefined, retries: 0, delayMs: 1000 },
      ...fallbacks.map((f) => ({ fallback: f, retries: f.retries, delayMs: f.delayMs })),
    ];

    for (let configIdx = 0; configIdx < executionConfigs.length; configIdx++) {
      const config = executionConfigs[configIdx]!;
      const isFallbackConfig = configIdx > 0;

      for (let attempt = 0; attempt <= config.retries; attempt++) {
        yield {
          fallback: config.fallback,
          delay: calculateDelay(attempt, config.delayMs, isFallbackConfig),
        };
      }
    }
  }

  private async executeSingleAttempt(
    message: Message,
    fallback?: Fallback | undefined,
    signal?: AbortSignal | undefined
  ): Promise<{ success: boolean; response?: ExecutionResponse }> {
    const context = await this.session.buildExecutionContext(
      message.content,
      message.env,
      fallback
    );

    if (!context) return { success: false };

    const mainResult = await this.withTypingIndicator(() =>
      this.runCommand({
        command: context.command,
        cwd: this.session.workDirectory,
        env: context.env,
        signal,
      })
    );

    let success = mainResult.exitCode === 0;
    let finalContent = mainResult.stdout;
    const additonalErrors = [];

    if (success && context.currentAgent.commands?.getMessageContent) {
      const extraction = await extractMessageContent(
        context,
        mainResult,
        this.runCommand,
        this.session.workDirectory,
        signal
      );
      if (extraction.error) additonalErrors.push(extraction.error);
      if (extraction.result !== undefined) finalContent = extraction.result;
      if (!finalContent.trim()) success = false;
    }

    let extractedSessionId: string | undefined;

    if (success && this.isNewSession && context.currentAgent.commands?.getSessionId) {
      const extraction = await extractSessionId(
        context,
        mainResult,
        this.runCommand,
        this.session.workDirectory,
        signal
      );
      if (extraction.error) additonalErrors.push(extraction.error);
      if (extraction.result) {
        extractedSessionId = extraction.result;
      }
    }

    return {
      success,
      response: {
        messageId: message.id,
        content: finalContent,
        command: context.command,
        cwd: this.session.workDirectory,
        extractedSessionId,
        result: {
          ...mainResult,
          stderr: [mainResult.stderr, ...additonalErrors].join('\n\n'),
        },
      },
    };
  }

  async executeWithFallbacks(
    message: Message,
    signal?: AbortSignal | undefined
  ): Promise<ExecutionResponse | undefined> {
    let lastResponse: ExecutionResponse | undefined;

    for (const attempt of this.getExecutionAttempts()) {
      if (attempt.delay > 0) {
        await this.session.logger.logCommandRetry({
          messageId: message.id,
          content: `Error running agent, retrying in ${Math.round(attempt.delay / 1000)} seconds...`,
          cwd: this.session.workDirectory,
        });
        await sleep(attempt.delay);
      }

      const attemptResult = await this.executeSingleAttempt(message, attempt.fallback, signal);

      lastResponse = attemptResult.response || lastResponse;
      if (attemptResult.success) {
        return lastResponse;
      }
    }

    return lastResponse;
  }
}
