/* eslint-disable max-lines */
import { type CommandLogMessage, type ChatMessage } from './chats.js';
import {
  type Settings,
  type Agent,
  type AgentSessionSettings,
  type FallbackSchema,
} from '../shared/config.js';
import {
  getActiveEnvironmentInfo,
  getEnvironmentPath,
  readEnvironment,
  writeAgentSessionSettings,
} from '../shared/workspace.js';
import { getApiContext, generateToken } from './auth.js';
import { emitTyping } from './events.js';
import { applyEnvOverrides, getActiveEnvKeys } from '../shared/utils/env.js';
import { z } from 'zod';

type Fallback = z.infer<typeof FallbackSchema>;

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

export type RunCommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type RunCommandFn = (args: {
  command: string;
  cwd: string;
  env: Record<string, string>;
  stdin?: string | undefined;
  signal?: AbortSignal | undefined;
}) => Promise<RunCommandResult>;

async function runExtractionCommand(
  name: string,
  command: string,
  runCommand: RunCommandFn,
  cwd: string,
  env: Record<string, string>,
  mainResult: RunCommandResult,
  signal?: AbortSignal
): Promise<{ result?: string; error?: string }> {
  try {
    console.log(`Executing extraction command (${name}): ${command}`);
    const res = await runCommand({
      command,
      cwd,
      env,
      stdin: mainResult.stdout,
      signal,
    });
    if (res.exitCode === 0) {
      return { result: res.stdout.trim() };
    } else {
      return { error: `${name} failed: ${res.stderr}` };
    }
  } catch (e) {
    return { error: `${name} error: ${(e as Error).message}` };
  }
}

function formatEnvironmentPrefix(
  prefix: string,
  replacements: { targetPath: string; executionCwd: string; envDir: string; envArgs: string }
): string {
  const map: Record<string, string> = {
    '{WORKSPACE_DIR}': replacements.targetPath,
    '{AGENT_DIR}': replacements.executionCwd,
    '{ENV_DIR}': replacements.envDir,
    '{HOME_DIR}': process.env.HOME || '',
    '{ENV_ARGS}': replacements.envArgs,
  };
  return prefix.replace(
    /{(WORKSPACE_DIR|AGENT_DIR|ENV_DIR|HOME_DIR|ENV_ARGS)}/g,
    (match) => map[match] || match
  );
}

export interface Logger {
  log(msg: ChatMessage): Promise<void>;
}

export interface Message {
  id: string;
  content: string;
  env: Record<string, string>;
}

export class AgentRunner {
  constructor(
    private readonly chatId: string,
    private readonly agentId: string,
    private readonly finalSessionId: string,
    private readonly mergedAgent: Agent,
    private readonly agentSessionSettings: AgentSessionSettings | null,
    private readonly executionCwd: string,
    private readonly cwd: string,
    private readonly settings: Settings | undefined,
    private readonly logger: Logger,
    private readonly runCommand: RunCommandFn
  ) {}

  get isNewSession(): boolean {
    return !this.agentSessionSettings;
  }

  private async withTypingIndicator<T>(fn: () => Promise<T>): Promise<T> {
    const interval = setInterval(() => emitTyping(this.chatId), 5000);
    try {
      return await fn();
    } finally {
      clearInterval(interval);
    }
  }

  private async buildExecutionContext(
    message: string,
    routerEnv: Record<string, string>,
    fallback?: Fallback
  ): Promise<{ command: string; env: Record<string, string>; currentAgent: Agent } | null> {
    const currentAgent: Agent = {
      ...this.mergedAgent,
      commands: {
        ...this.mergedAgent.commands,
        ...(fallback?.commands || {}),
      },
      env: {
        ...this.mergedAgent.env,
        ...(fallback?.env || {}),
      },
    };

    let initialCommand = currentAgent.commands?.new ?? '';
    const env = {
      ...process.env,
      CLAW_CLI_MESSAGE: message,
    } as Record<string, string>;

    applyEnvOverrides(env, currentAgent.env);

    if (!this.isNewSession && currentAgent.commands?.append) {
      initialCommand = currentAgent.commands.append;
      applyEnvOverrides(env, this.agentSessionSettings?.env);
    }

    if (!initialCommand) {
      return null;
    }

    const agentSpecificEnvKeys = getActiveEnvKeys(
      currentAgent.env,
      !this.isNewSession ? this.agentSessionSettings?.env : undefined
    );
    agentSpecificEnvKeys.add('CLAW_CLI_MESSAGE');

    Object.assign(env, routerEnv);
    Object.keys(routerEnv).forEach((k) => agentSpecificEnvKeys.add(k));

    const apiCtx = getApiContext(this.settings);
    if (apiCtx) {
      const proxyUrl = apiCtx.proxy_host
        ? `${apiCtx.proxy_host}:${apiCtx.port}`
        : `http://${apiCtx.host}:${apiCtx.port}`;
      env['CLAW_API_URL'] = proxyUrl;
      agentSpecificEnvKeys.add('CLAW_API_URL');

      const token = generateToken({
        chatId: this.chatId,
        agentId: this.agentId,
        sessionId: this.finalSessionId,
        timestamp: Date.now(),
      });
      env['CLAW_API_TOKEN'] = token;
      agentSpecificEnvKeys.add('CLAW_API_TOKEN');
    }

    let command = initialCommand;
    command = await this.sandboxExecutionContext(command, env, agentSpecificEnvKeys);

    return { command, env, currentAgent };
  }

  private async sandboxExecutionContext(
    initialCommand: string,
    env: Record<string, string>,
    agentSpecificEnvKeys: Set<string>
  ): Promise<string> {
    let command = initialCommand;
    const activeEnvInfo = await getActiveEnvironmentInfo(this.executionCwd, this.cwd);
    if (!activeEnvInfo) return command;

    const activeEnvName = activeEnvInfo.name;
    const activeEnv = await readEnvironment(activeEnvName, this.cwd);

    if (activeEnv?.env) {
      for (const [key, value] of Object.entries(activeEnv.env)) {
        if (value === false) {
          delete env[key];
          agentSpecificEnvKeys.delete(key);
        } else {
          let interpolatedValue = String(value);
          interpolatedValue = interpolatedValue.replace(/\{PATH\}/g, process.env.PATH || '');
          interpolatedValue = interpolatedValue.replace(
            /\{ENV_DIR\}/g,
            getEnvironmentPath(activeEnvName, this.cwd)
          );
          interpolatedValue = interpolatedValue.replace(
            /\{WORKSPACE_DIR\}/g,
            activeEnvInfo.targetPath
          );
          env[key] = interpolatedValue;
          agentSpecificEnvKeys.add(key);
        }
      }
    }

    if (activeEnv?.prefix) {
      const envArgs = Array.from(agentSpecificEnvKeys)
        .map((key) => {
          if (activeEnv.envFormat) {
            return activeEnv.envFormat.replace('{key}', key);
          }
          return key;
        })
        .join(' ');

      const prefixReplaced = formatEnvironmentPrefix(activeEnv.prefix, {
        targetPath: activeEnvInfo.targetPath,
        executionCwd: this.executionCwd,
        envDir: getEnvironmentPath(activeEnvName, this.cwd),
        envArgs,
      });

      if (prefixReplaced.includes('{COMMAND}')) {
        command = prefixReplaced.replace('{COMMAND}', command);
      } else {
        command = `${prefixReplaced} ${command}`;
      }
    }

    return command;
  }

  private async extractMessageContent(
    context: { command: string; env: Record<string, string>; currentAgent: Agent },
    mainResult: RunCommandResult,
    signal?: AbortSignal
  ): Promise<{ result?: string; error?: string }> {
    if (!context.currentAgent.commands?.getMessageContent) return {};
    return runExtractionCommand(
      'getMessageContent',
      context.currentAgent.commands.getMessageContent,
      this.runCommand,
      this.executionCwd,
      context.env,
      mainResult,
      signal
    );
  }

  private async extractSessionId(
    context: { command: string; env: Record<string, string>; currentAgent: Agent },
    mainResult: RunCommandResult,
    signal?: AbortSignal
  ): Promise<{ result?: string; error?: string }> {
    if (!context.currentAgent.commands?.getSessionId) return {};
    return runExtractionCommand(
      'getSessionId',
      context.currentAgent.commands.getSessionId,
      this.runCommand,
      this.executionCwd,
      context.env,
      mainResult,
      signal
    );
  }

  private buildLogMessage(
    messageId: string,
    command: string,
    content: string,
    errors: string[],
    mainResult: RunCommandResult
  ): CommandLogMessage {
    const isVerbose = content.includes('NO_REPLY_NECESSARY');
    return {
      id: crypto.randomUUID(),
      messageId,
      role: 'log',
      content,
      stdout: mainResult.stdout,
      stderr: errors.join('\n\n'),
      timestamp: new Date().toISOString(),
      command,
      cwd: this.executionCwd,
      exitCode: mainResult.exitCode,
      ...(isVerbose ? { level: 'verbose' as const } : {}),
    };
  }

  private *getExecutionAttempts() {
    const fallbacks = this.mergedAgent.fallbacks || [];
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
  ): Promise<{ success: boolean; logMsg?: CommandLogMessage }> {
    const context = await this.buildExecutionContext(message.content, message.env, fallback);
    if (!context) return { success: false };

    const mainResult = await this.withTypingIndicator(() =>
      this.runCommand({
        command: context.command,
        cwd: this.executionCwd,
        env: context.env,
        signal,
      })
    );

    let success = mainResult.exitCode === 0;
    let finalContent = mainResult.stdout;
    const errors = mainResult.stderr ? [mainResult.stderr] : [];

    if (success && context.currentAgent.commands?.getMessageContent) {
      const extraction = await this.extractMessageContent(context, mainResult, signal);
      if (extraction.error) errors.push(extraction.error);
      if (extraction.result !== undefined) finalContent = extraction.result;
      if (!finalContent.trim()) success = false;
    }

    if (success && this.isNewSession && context.currentAgent.commands?.getSessionId) {
      const extraction = await this.extractSessionId(context, mainResult, signal);
      if (extraction.error) errors.push(extraction.error);
      if (extraction.result) {
        await writeAgentSessionSettings(
          this.agentId,
          this.finalSessionId,
          { env: { SESSION_ID: extraction.result } },
          this.cwd
        );
      }
    }

    return {
      success,
      logMsg: this.buildLogMessage(message.id, context.command, finalContent, errors, mainResult),
    };
  }

  async executeWithFallbacks(
    message: Message,
    signal?: AbortSignal | undefined
  ): Promise<CommandLogMessage | undefined> {
    let lastLogMsg: CommandLogMessage | undefined;

    for (const attempt of this.getExecutionAttempts()) {
      if (attempt.delay > 0) {
        const retryLogMsg: CommandLogMessage = {
          id: crypto.randomUUID(),
          messageId: message.id,
          role: 'log',
          content: `Error running agent, retrying in ${Math.round(attempt.delay / 1000)} seconds...`,
          stderr: '',
          timestamp: new Date().toISOString(),
          command: 'retry-delay',
          cwd: this.executionCwd,
          exitCode: 0,
        };
        await this.logger.log(retryLogMsg);
        await sleep(attempt.delay);
      }

      const attemptResult = await this.executeSingleAttempt(message, attempt.fallback, signal);

      lastLogMsg = attemptResult.logMsg || lastLogMsg;
      if (attemptResult.success) {
        return lastLogMsg;
      }
    }

    return lastLogMsg;
  }
}
