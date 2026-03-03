/* eslint-disable max-lines */
import path from 'node:path';
import { appendMessage, type UserMessage, type CommandLogMessage } from '../shared/chats.js';
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
} from '../shared/workspace.js';
import { getApiContext, generateToken } from './auth.js';
import { z } from 'zod';

type Fallback = z.infer<typeof FallbackSchema>;

export type RunCommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type RunCommandFn = (args: {
  command: string;
  cwd: string;
  env: Record<string, string>;
  stdin?: string;
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
  let env = {
    ...process.env,
    ...(currentAgent.env || {}),
    CLAW_CLI_MESSAGE: message,
  } as Record<string, string>;

  if (!isNewSession && currentAgent.commands?.append) {
    command = currentAgent.commands.append;
    const sessionEnv = agentSessionSettings?.env || {};
    env = { ...env, ...sessionEnv };
  }

  return { command, env, currentAgent };
}

async function runExtractionCommand(
  name: string,
  command: string,
  runCommand: RunCommandFn,
  cwd: string,
  env: Record<string, string>,
  mainResult: RunCommandResult
): Promise<{ result?: string; error?: string }> {
  try {
    const res = await runCommand({
      command,
      cwd,
      env,
      stdin: mainResult.stdout,
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

export async function executeDirectMessage(
  chatId: string,
  state: RouterState,
  settings: Settings | undefined,
  cwd: string,
  runCommand: RunCommandFn,
  noWait: boolean = true,
  userMessageContent?: string
): Promise<void> {
  const userMsg: UserMessage = {
    id: crypto.randomUUID(),
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
    };
    await appendMessage(chatId, routerLogMsg);
  }

  if (!state.message.trim()) {
    return;
  }

  const queue = getQueue(cwd);
  const routerEnv = state.env ?? {};

  const taskPromise = queue.enqueue(async () => {
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
    const executionConfigs: { fallback?: Fallback; retries: number }[] = [
      { retries: 0 },
      ...fallbacks.map((f) => ({ fallback: f, retries: f.retries })),
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

    for (const config of executionConfigs) {
      for (let attempt = 0; attempt <= config.retries; attempt++) {
        const { command, env, currentAgent } = prepareCommandAndEnv(
          mergedAgent,
          state.message,
          isNewSession,
          agentSessionSettings,
          config.fallback
        );

        if (!command) {
          continue;
        }

        Object.assign(env, routerEnv);

        const apiCtx = getApiContext(settings);
        if (apiCtx) {
          if (apiCtx.proxy_host) {
            env['CLAW_API_URL'] = `${apiCtx.proxy_host}:${apiCtx.port}`;
          } else {
            env['CLAW_API_URL'] = `http://${apiCtx.host}:${apiCtx.port}`;
          }
          env['CLAW_API_TOKEN'] = generateToken({
            chatId,
            agentId,
            sessionId: finalSessionId,
            timestamp: Date.now(),
          });
        }

        const mainResult = await runCommand({ command, cwd: executionCwd, env });

        const logMsg: CommandLogMessage = {
          id: crypto.randomUUID(),
          messageId: userMsg.id,
          role: 'log',
          content: mainResult.stdout,
          stderr: '',
          timestamp: new Date().toISOString(),
          command,
          cwd: executionCwd,
          exitCode: mainResult.exitCode,
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
              mainResult
            );
            if (result !== undefined) {
              logMsg.content = result;
              logMsg.stdout = mainResult.stdout;
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
              mainResult
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
  });

  if (!noWait) {
    await taskPromise;
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

  return {
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
    message: finalMessage,
    chatId,
    env: routerEnv,
  };
  if (finalAgentId !== undefined) directState.agentId = finalAgentId;
  if (finalSessionId !== undefined) directState.sessionId = finalSessionId;
  if (finalState.reply !== undefined) directState.reply = finalState.reply;

  await executeDirectMessage(chatId, directState, settings, cwd, runCommand, noWait, message);
}
