import path from 'node:path';
import { appendMessage, type UserMessage, type CommandLogMessage } from '../shared/chats.js';
import { getQueue } from './queue.js';
import { type Settings, type Agent, type AgentSessionSettings } from '../shared/config.js';
import {
  readChatSettings,
  writeChatSettings,
  readAgentSessionSettings,
  writeAgentSessionSettings,
  getAgent,
  getWorkspaceRoot,
} from '../shared/workspace.js';

export type RunCommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

type RunCommandFn = (args: {
  command: string;
  cwd: string;
  env: Record<string, string>;
  stdin?: string;
}) => Promise<RunCommandResult>;

async function resolveSessionState(chatId: string, cwd: string, sessionId?: string) {
  const chatSettings = await readChatSettings(chatId, cwd);
  const agentId =
    typeof chatSettings?.defaultAgent === 'string' ? chatSettings.defaultAgent : 'default';

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
  agentSessionSettings: AgentSessionSettings | null
): { command: string; env: Record<string, string> } {
  let command = agent.commands!.new!;
  let env = {
    ...process.env,
    ...(agent.env || {}),
    CLAW_CLI_MESSAGE: message,
  } as Record<string, string>;

  if (!isNewSession && agent.commands?.append) {
    command = agent.commands.append;
    const sessionEnv = agentSessionSettings?.env || {};
    env = { ...env, ...sessionEnv };
  }

  return { command, env };
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

export async function handleUserMessage(
  chatId: string,
  message: string,
  settings: Settings | undefined,
  cwd: string = process.cwd(),
  noWait: boolean = false,
  runCommand: RunCommandFn,
  sessionId?: string
): Promise<void> {
  if (!settings?.defaultAgent?.commands?.new) {
    throw new Error('No defaultAgent.commands.new defined in settings.json');
  }

  const userMsg: UserMessage = {
    id: crypto.randomUUID(),
    role: 'user',
    content: message,
    timestamp: new Date().toISOString(),
  };
  await appendMessage(chatId, userMsg);

  const queue = getQueue(cwd);

  const taskPromise = queue.enqueue(async () => {
    const { chatSettings, agentId, agentSessionSettings, isNewSession } = await resolveSessionState(
      chatId,
      cwd,
      sessionId
    );

    let mergedAgent: Agent = settings.defaultAgent || {};
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

    const workspaceRoot = getWorkspaceRoot(cwd);
    let executionCwd = cwd;
    if (mergedAgent.directory) {
      executionCwd = path.resolve(workspaceRoot, mergedAgent.directory);
    } else if (agentId !== 'default') {
      executionCwd = path.resolve(workspaceRoot, agentId);
    }

    const { command, env } = prepareCommandAndEnv(
      mergedAgent,
      message,
      isNewSession,
      agentSessionSettings
    );

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

    if (mainResult.exitCode === 0) {
      // Save the session id if it's a new session
      if (isNewSession && mergedAgent.commands?.getSessionId) {
        const { result, error } = await runExtractionCommand(
          'getSessionId',
          mergedAgent.commands.getSessionId,
          runCommand,
          executionCwd,
          env,
          mainResult
        );
        if (result) {
          const newChatSettings = chatSettings ?? {};
          newChatSettings.defaultAgent = agentId;
          newChatSettings.sessions = newChatSettings.sessions || {};
          const internalSessionId = sessionId ?? result;
          newChatSettings.sessions[agentId] = internalSessionId;
          await writeChatSettings(chatId, newChatSettings, cwd);

          // Create initial agent session settings
          await writeAgentSessionSettings(
            agentId,
            internalSessionId,
            { env: { SESSION_ID: result } },
            cwd
          );
        }
        if (error) {
          errors.push(error);
        }
      }

      // Try extracting the message content
      if (mergedAgent.commands?.getMessageContent) {
        const { result, error } = await runExtractionCommand(
          'getMessageContent',
          mergedAgent.commands.getMessageContent,
          runCommand,
          executionCwd,
          env,
          mainResult
        );
        if (result !== undefined) {
          logMsg.content = result;
          logMsg.stdout = mainResult.stdout;
        }
        if (error) {
          errors.push(error);
        }
      }
    }

    logMsg.stderr = errors.join('\n\n');
    await appendMessage(chatId, logMsg);
  });

  if (!noWait) {
    await taskPromise;
  }
}
