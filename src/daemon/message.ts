import { appendMessage, type UserMessage, type CommandLogMessage } from '../shared/chats.js';
import { getQueue } from './queue.js';
import { type Settings } from '../shared/config.js';
import {
  readChatSettings,
  writeChatSettings,
  readAgentSessionSettings,
  writeAgentSessionSettings,
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
    const sessions = (chatSettings?.sessions as Record<string, string>) || {};
    targetSessionId = sessions[agentId] || 'default';
  }

  const agentSessionSettings = await readAgentSessionSettings(agentId, targetSessionId, cwd);
  const isNewSession = !agentSessionSettings;

  return { chatSettings, agentId, targetSessionId, agentSessionSettings, isNewSession };
}

function prepareCommandAndEnv(
  settings: Settings,
  message: string,
  isNewSession: boolean,
  agentSessionSettings: Record<string, unknown> | null
): { command: string; env: Record<string, string> } {
  let command = settings.defaultAgent!.commands!.new!;
  let env = {
    ...process.env,
    ...(settings.defaultAgent!.env || {}),
    CLAW_CLI_MESSAGE: message,
  } as Record<string, string>;

  if (!isNewSession && settings.defaultAgent!.commands?.append) {
    command = settings.defaultAgent!.commands.append;
    const sessionEnv = (agentSessionSettings?.env as Record<string, string>) || {};
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
  // TODO: Immediately persist the user message somewhere (e.g., a crash-recovery log)
  // before enqueueing it, in case the daemon crashes before processing this queue item.

  if (!settings?.defaultAgent?.commands?.new) {
    throw new Error('No defaultAgent.commands.new defined in settings.json');
  }

  const queue = getQueue(cwd);

  const taskPromise = queue.enqueue(async () => {
    const { chatSettings, agentId, agentSessionSettings, isNewSession } = await resolveSessionState(
      chatId,
      cwd,
      sessionId
    );
    const { command, env } = prepareCommandAndEnv(
      settings,
      message,
      isNewSession,
      agentSessionSettings
    );

    const userMsg: UserMessage = {
      role: 'user',
      content: message,
      timestamp: new Date().toISOString(),
    };
    await appendMessage(chatId, userMsg);

    const mainResult = await runCommand({ command, cwd, env });

    const logMsg: CommandLogMessage = {
      role: 'log',
      content: mainResult.stdout,
      stderr: '',
      timestamp: new Date().toISOString(),
      command,
      cwd,
      exitCode: mainResult.exitCode,
    };

    const errors: string[] = [];
    if (mainResult.stderr) {
      errors.push(mainResult.stderr);
    }

    if (mainResult.exitCode === 0) {
      // Save the session id if it's a new session
      if (isNewSession && settings.defaultAgent!.commands?.getSessionId) {
        const { result, error } = await runExtractionCommand(
          'getSessionId',
          settings.defaultAgent!.commands.getSessionId,
          runCommand,
          cwd,
          env,
          mainResult
        );
        if (result) {
          const newChatSettings = chatSettings ?? {};
          newChatSettings.defaultAgent = agentId;
          newChatSettings.sessions = newChatSettings.sessions || {};
          const internalSessionId = sessionId ?? result;
          (newChatSettings.sessions as Record<string, string>)[agentId] = internalSessionId;
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
      if (settings.defaultAgent!.commands?.getMessageContent) {
        const { result, error } = await runExtractionCommand(
          'getMessageContent',
          settings.defaultAgent!.commands.getMessageContent,
          runCommand,
          cwd,
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
