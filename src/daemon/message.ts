/* eslint-disable max-lines */
import path from 'node:path';
import { appendMessage, type UserMessage, type CommandLogMessage } from './chats.js';
import { getQueue } from './queue.js';
import { executeRouterPipeline } from './routers.js';
import type { RouterState } from './routers/types.js';
import {
  type Settings,
  type Agent,
  type AgentSessionSettings,
  type FallbackSchema,
} from '../shared/config.js';
import {
  readChatSettings,
  writeChatSettings,
  readAgentSessionSettings,
  writeAgentSessionSettings,
  getAgent,
  getWorkspaceRoot,
  getActiveEnvironmentInfo,
  getEnvironmentPath,
  readEnvironment,
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

export function formatPendingMessages(payloads: string[]): string {
  return payloads.map((text) => `<message>\n${text}\n</message>`).join('\n\n');
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

function prepareCommandAndEnv(
  agent: Agent,
  message: string,
  isNewSession: boolean,
  agentSessionSettings: AgentSessionSettings | null,
  fallback?: Fallback
): { command: string; env: Record<string, string>; currentAgent: Agent } {
  const currentAgent: Agent = {
    ...agent,
    commands: {
      ...agent.commands,
      ...(fallback?.commands || {}),
    },
    env: {
      ...agent.env,
      ...(fallback?.env || {}),
    },
  };

  let command = currentAgent.commands?.new ?? '';
  const env = {
    ...process.env,
    CLAW_CLI_MESSAGE: message,
  } as Record<string, string>;

  applyEnvOverrides(env, currentAgent.env);

  if (!isNewSession && currentAgent.commands?.append) {
    command = currentAgent.commands.append;
    applyEnvOverrides(env, agentSessionSettings?.env);
  }

  return { command, env, currentAgent };
}

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

/**
 * Formats the environment prefix string by replacing placeholders with actual values.
 * Available placeholders:
 * - {WORKSPACE_DIR}: The root directory of the workspace.
 * - {AGENT_DIR}: The directory where the agent is executing.
 * - {ENV_DIR}: The directory of the active environment.
 * - {HOME_DIR}: The home directory of the current user.
 * - {ENV_ARGS}: The formatted environment arguments based on envFormat.
 */
function formatEnvironmentPrefix(
  prefix: string,
  replacements: {
    targetPath: string;
    executionCwd: string;
    envDir: string;
    envArgs: string;
  }
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

export async function executeDirectMessage(
  chatId: string,
  state: RouterState,
  settings: Settings | undefined,
  cwd: string,
  runCommand: RunCommandFn,
  noWait: boolean = false,
  userMessageContent?: string
) {
  const userMsg: UserMessage = {
    id: state.messageId ?? crypto.randomUUID(),
    role: 'user',
    content: userMessageContent ?? state.message,
    timestamp: new Date().toISOString(),
  };
  await appendMessage(chatId, userMsg);

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
    await appendMessage(chatId, routerLogMsg);
  }

  if (!state.message.trim() && state.action !== 'stop' && state.action !== 'interrupt') {
    return;
  }

  const queue = getQueue(cwd);

  if (state.action === 'stop') {
    queue.abortCurrent();
    queue.clear();
    return;
  }

  if (state.action === 'interrupt') {
    const currentPayload = queue.getCurrentPayload();
    queue.abortCurrent();

    const extracted = queue.extractPending();
    const payloads = currentPayload ? [currentPayload, ...extracted] : extracted;

    if (payloads.length > 0) {
      const pendingText = formatPendingMessages(payloads);
      state.message = `${pendingText}\n\n<message>\n${state.message}\n</message>`.trim();
    }
  }

  if (!state.message.trim()) {
    return;
  }

  const routerEnv = state.env ?? {};

  const taskPromise = queue.enqueue(async (signal) => {
    const {
      agentId,
      agentSessionSettings,
      isNewSession,
      targetSessionId: finalSessionId,
    } = await resolveSessionState(chatId, cwd, state.sessionId, state.agentId);

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

    const fallbacks = mergedAgent.fallbacks || [];
    const executionConfigs: { fallback?: Fallback; retries: number; delayMs: number }[] = [
      { retries: 0, delayMs: 1000 },
      ...fallbacks.map((f) => ({ fallback: f, retries: f.retries, delayMs: f.delayMs })),
    ];

    const workspaceRoot = getWorkspaceRoot(cwd);
    let executionCwd = cwd;
    if (mergedAgent.directory) {
      executionCwd = path.resolve(workspaceRoot, mergedAgent.directory);
    } else if (agentId !== 'default') {
      executionCwd = path.resolve(workspaceRoot, agentId);
    }

    let lastLogMsg: CommandLogMessage | undefined;
    let success = false;

    for (let configIdx = 0; configIdx < executionConfigs.length; configIdx++) {
      const config = executionConfigs[configIdx]!;
      const isFallbackConfig = configIdx > 0;
      for (let attempt = 0; attempt <= config.retries; attempt++) {
        const delay = calculateDelay(attempt, config.delayMs, isFallbackConfig);
        if (delay > 0) {
          const retryLogMsg: CommandLogMessage = {
            id: crypto.randomUUID(),
            messageId: userMsg.id,
            role: 'log',
            content: `Error running agent, retrying in ${Math.round(delay / 1000)} seconds...`,
            stderr: '',
            timestamp: new Date().toISOString(),
            command: 'retry-delay',
            cwd: executionCwd,
            exitCode: 0,
          };
          await appendMessage(chatId, retryLogMsg);
          await sleep(delay);
        }

        const {
          env,
          currentAgent,
          command: initialCommand,
        } = prepareCommandAndEnv(
          mergedAgent,
          state.message,
          isNewSession,
          agentSessionSettings,
          config.fallback
        );
        let command = initialCommand;

        if (!command) {
          continue;
        }

        const agentSpecificEnv = getActiveEnvKeys(
          currentAgent.env,
          !isNewSession ? agentSessionSettings?.env : undefined
        );
        agentSpecificEnv.add('CLAW_CLI_MESSAGE');

        Object.assign(env, routerEnv);
        Object.keys(routerEnv).forEach((k) => agentSpecificEnv.add(k));

        const apiCtx = getApiContext(settings);
        if (apiCtx) {
          const proxyUrl = apiCtx.proxy_host
            ? `${apiCtx.proxy_host}:${apiCtx.port}`
            : `http://${apiCtx.host}:${apiCtx.port}`;
          env['CLAW_API_URL'] = proxyUrl;
          agentSpecificEnv.add('CLAW_API_URL');

          const token = generateToken({
            chatId,
            agentId,
            sessionId: finalSessionId,
            timestamp: Date.now(),
          });
          env['CLAW_API_TOKEN'] = token;
          agentSpecificEnv.add('CLAW_API_TOKEN');
        }

        const activeEnvInfo = await getActiveEnvironmentInfo(executionCwd, cwd);
        if (activeEnvInfo) {
          const activeEnvName = activeEnvInfo.name;
          const activeEnv = await readEnvironment(activeEnvName, cwd);

          if (activeEnv?.env) {
            for (const [key, value] of Object.entries(activeEnv.env)) {
              if (value === false) {
                delete env[key];
                agentSpecificEnv.delete(key);
              } else {
                let interpolatedValue = String(value);
                interpolatedValue = interpolatedValue.replace(/\{PATH\}/g, process.env.PATH || '');
                interpolatedValue = interpolatedValue.replace(
                  /\{ENV_DIR\}/g,
                  getEnvironmentPath(activeEnvName, cwd)
                );
                interpolatedValue = interpolatedValue.replace(
                  /\{WORKSPACE_DIR\}/g,
                  activeEnvInfo.targetPath
                );
                env[key] = interpolatedValue;
                agentSpecificEnv.add(key);
              }
            }
          }

          if (activeEnv?.prefix) {
            const envArgs = Array.from(agentSpecificEnv)
              .map((key) => {
                if (activeEnv.envFormat) {
                  return activeEnv.envFormat.replace('{key}', key);
                }
                return key;
              })
              .join(' ');

            const prefixReplaced = formatEnvironmentPrefix(activeEnv.prefix, {
              targetPath: activeEnvInfo.targetPath,
              executionCwd,
              envDir: getEnvironmentPath(activeEnvName, cwd),
              envArgs,
            });

            if (prefixReplaced.includes('{COMMAND}')) {
              command = prefixReplaced.replace('{COMMAND}', command);
            } else {
              command = `${prefixReplaced} ${command}`;
            }
          }
        }

        console.log(`Executing command: ${command}`);
        let mainResult;
        const typingInterval = setInterval(() => {
          emitTyping(chatId);
        }, 5000);
        try {
          mainResult = await runCommand({ command, cwd: executionCwd, env, signal });
        } finally {
          clearInterval(typingInterval);
        }

        const logMsg: CommandLogMessage = {
          id: crypto.randomUUID(),
          messageId: userMsg.id,
          role: 'log',
          content: mainResult.stdout,
          stdout: mainResult.stdout,
          stderr: '',
          timestamp: new Date().toISOString(),
          command,
          cwd: executionCwd,
          exitCode: mainResult.exitCode,
          ...(mainResult.stdout.includes('NO_REPLY_NECESSARY')
            ? { level: 'verbose' as const }
            : {}),
        };

        const errors: string[] = [];
        if (mainResult.stderr) {
          errors.push(mainResult.stderr);
        }

        let currentSuccess = mainResult.exitCode === 0;

        if (currentSuccess) {
          if (currentAgent.commands?.getMessageContent) {
            const { result, error } = await runExtractionCommand(
              'getMessageContent',
              currentAgent.commands.getMessageContent,
              runCommand,
              executionCwd,
              env,
              mainResult,
              signal
            );
            if (result !== undefined) {
              logMsg.content = result;
              logMsg.stdout = mainResult.stdout;
              if (result.includes('NO_REPLY_NECESSARY')) {
                logMsg.level = 'verbose';
              } else {
                delete logMsg.level;
              }
              if (result.trim() === '') {
                currentSuccess = false;
              }
            }
            if (error) {
              errors.push(error);
            }
          }
        }

        logMsg.stderr = errors.join('\n\n');
        lastLogMsg = logMsg;

        if (currentSuccess) {
          success = true;
          if (isNewSession && currentAgent.commands?.getSessionId) {
            const { result, error } = await runExtractionCommand(
              'getSessionId',
              currentAgent.commands.getSessionId,
              runCommand,
              executionCwd,
              env,
              mainResult,
              signal
            );
            if (result) {
              await writeAgentSessionSettings(
                agentId,
                finalSessionId,
                { env: { SESSION_ID: result } },
                cwd
              );
            }
            if (error) {
              // We don't fail the whole thing for getSessionId error, but we log it.
              logMsg.stderr = [logMsg.stderr, error].filter(Boolean).join('\n\n');
            }
          }
          break;
        }
      }
      if (success) break;
    }

    if (lastLogMsg) {
      await appendMessage(chatId, lastLogMsg);
    }
  }, state.message);

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
  overrideSessionId?: string,
  overrideMessageId?: string
): Promise<RouterState> {
  const chatSettings = (await readChatSettings(chatId, cwd)) ?? {};
  const agentId = overrideAgentId ?? chatSettings.defaultAgent ?? 'default';
  const sessionId = overrideSessionId ?? chatSettings.sessions?.[agentId] ?? 'default';
  const messageId = overrideMessageId ?? crypto.randomUUID();

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
  runCommand: RunCommandFn,
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

  await executeDirectMessage(chatId, directState, settings, cwd, runCommand, noWait, message);
}
