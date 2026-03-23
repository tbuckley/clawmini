import type { RunCommandFn, RunCommandResult } from './types.js';
import type { Agent } from '../../shared/config.js';

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

export async function extractMessageContent(
  context: { command: string; env: Record<string, string>; currentAgent: Agent },
  mainResult: RunCommandResult,
  runCommand: RunCommandFn,
  executionCwd: string,
  signal?: AbortSignal
): Promise<{ result?: string; error?: string }> {
  if (!context.currentAgent.commands?.getMessageContent) return {};
  return runExtractionCommand(
    'getMessageContent',
    context.currentAgent.commands.getMessageContent,
    runCommand,
    executionCwd,
    context.env,
    mainResult,
    signal
  );
}

export async function extractSessionId(
  context: { command: string; env: Record<string, string>; currentAgent: Agent },
  mainResult: RunCommandResult,
  runCommand: RunCommandFn,
  executionCwd: string,
  signal?: AbortSignal
): Promise<{ result?: string; error?: string }> {
  if (!context.currentAgent.commands?.getSessionId) return {};
  return runExtractionCommand(
    'getSessionId',
    context.currentAgent.commands.getSessionId,
    runCommand,
    executionCwd,
    context.env,
    mainResult,
    signal
  );
}
