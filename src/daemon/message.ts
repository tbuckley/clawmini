import { appendMessage, type UserMessage, type CommandLogMessage } from '../shared/chats.js';
import { getQueue } from './queue.js';
import { type Settings } from '../shared/config.js';
import { readChatSettings, writeChatSettings, readAgentSessionSettings, writeAgentSessionSettings } from '../shared/workspace.js';

export type RunCommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export async function handleUserMessage(
  chatId: string,
  message: string,
  settings: Settings | undefined,
  cwd: string = process.cwd(),
  noWait: boolean = false,
  runCommand: (args: { command: string; cwd: string; env: Record<string, string>; stdin?: string }) => Promise<RunCommandResult>,
  sessionId?: string
): Promise<void> {
  // TODO: Immediately persist the user message somewhere (e.g., a crash-recovery log)
  // before enqueueing it, in case the daemon crashes before processing this queue item.

  if (!settings?.defaultAgent?.commands?.new) {
    throw new Error('No defaultAgent.commands.new defined in settings.json');
  }

  const queue = getQueue(cwd);

  const taskPromise = queue.enqueue(async () => {
    let chatSettings = await readChatSettings(chatId, cwd);
    const agentId = typeof chatSettings?.defaultAgent === 'string' ? chatSettings.defaultAgent : 'default';

    let targetSessionId = sessionId;
    if (!targetSessionId) {
      const sessions = (chatSettings?.sessions as Record<string, string>) || {};
      targetSessionId = sessions[agentId] || 'default';
    }

    const agentSessionSettings = await readAgentSessionSettings(agentId, targetSessionId, cwd);

    const isNewSession = !agentSessionSettings;

    let command = settings.defaultAgent!.commands!.new!;
    let env = {
      ...process.env,
      ...(settings.defaultAgent!.env || {}),
      CLAW_CLI_MESSAGE: message,
    } as Record<string, string>;

    if (!isNewSession && settings.defaultAgent!.commands?.append) {
      command = settings.defaultAgent!.commands.append;
      const sessionEnv = (agentSessionSettings.env as Record<string, string>) || {};
      env = { ...env, ...sessionEnv };
    }

    const userMsg: UserMessage = {
      role: 'user',
      content: message,
      timestamp: new Date().toISOString(),
    };
    await appendMessage(chatId, userMsg);

    const mainResult = await runCommand({
      command,
      cwd,
      env,
    });

    let extractedMessage: string | undefined;
    let extractionError: string | undefined;

    if (mainResult.exitCode === 0) {
      let extractedSessionId: string | undefined;

      if (isNewSession && settings.defaultAgent!.commands?.getSessionId) {
        try {
          const getSessionResult = await runCommand({
            command: settings.defaultAgent!.commands.getSessionId,
            cwd,
            env,
            stdin: mainResult.stdout,
          });

          if (getSessionResult.exitCode === 0) {
            extractedSessionId = getSessionResult.stdout.trim();
            if (extractedSessionId) {
              chatSettings = chatSettings || {};
              chatSettings.defaultAgent = agentId;
              chatSettings.sessions = chatSettings.sessions || {};
              (chatSettings.sessions as Record<string, string>)[agentId] = extractedSessionId;
              await writeChatSettings(chatId, chatSettings, cwd);

              // Create initial agent session settings
              await writeAgentSessionSettings(agentId, extractedSessionId, { env: {} }, cwd);
            }
          } else {
             extractionError = `getSessionId failed: ${getSessionResult.stderr}`;
          }
        } catch (e) {
           extractionError = `getSessionId error: ${(e as Error).message}`;
        }
      }

      if (settings.defaultAgent!.commands?.getMessageContent) {
        try {
          const getContentResult = await runCommand({
            command: settings.defaultAgent!.commands.getMessageContent,
            cwd,
            env,
            stdin: mainResult.stdout,
          });
          if (getContentResult.exitCode === 0) {
            extractedMessage = getContentResult.stdout.trim();
          } else {
            extractionError = (extractionError ? extractionError + '\n' : '') + `getMessageContent failed: ${getContentResult.stderr}`;
          }
        } catch (e) {
          extractionError = (extractionError ? extractionError + '\n' : '') + `getMessageContent error: ${(e as Error).message}`;
        }
      }
    }

    const logMsg: CommandLogMessage = {
      role: 'log',
      content: mainResult.stdout,
      stderr: extractionError ? (mainResult.stderr ? mainResult.stderr + '\n' + extractionError : extractionError) : mainResult.stderr,
      timestamp: new Date().toISOString(),
      command,
      cwd,
      exitCode: mainResult.exitCode,
      // extractedMessage will be added to this struct in Ticket 6
      ...(extractedMessage && { extractedMessage }),
    };
    await appendMessage(chatId, logMsg);
  });

  if (!noWait) {
    await taskPromise;
  }
}
