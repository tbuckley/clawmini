import {
  type Agent,
  type AgentSessionSettings,
  type FallbackSchema,
  type Settings,
} from '../../shared/config.js';
import {
  getActiveEnvironmentInfo,
  getEnvironmentPath,
  readEnvironment,
} from '../../shared/workspace.js';
import { applyEnvOverrides, getActiveEnvKeys } from '../../shared/utils/env.js';
import { getApiContext, generateToken } from '../auth.js';
import { z } from 'zod';

export type Fallback = z.infer<typeof FallbackSchema>;

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

export async function sandboxExecutionContext(
  initialCommand: string,
  env: Record<string, string>,
  agentSpecificEnvKeys: Set<string>,
  executionCwd: string,
  cwd: string
): Promise<string> {
  let command = initialCommand;
  const activeEnvInfo = await getActiveEnvironmentInfo(executionCwd, cwd);
  if (!activeEnvInfo) return command;

  const activeEnvName = activeEnvInfo.name;
  const activeEnv = await readEnvironment(activeEnvName, cwd);

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
          getEnvironmentPath(activeEnvName, cwd)
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
      executionCwd: executionCwd,
      envDir: getEnvironmentPath(activeEnvName, cwd),
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

export interface BuildContextOptions {
  message: string;
  routerEnv: Record<string, string>;
  fallback?: Fallback | undefined;
  mergedAgent: Agent;
  isNewSession: boolean;
  agentSessionSettings: AgentSessionSettings | null;
  settings: Settings | undefined;
  chatId: string;
  agentId: string;
  finalSessionId: string;
  executionCwd: string;
  cwd: string;
}

export async function buildAgentContext(
  options: BuildContextOptions
): Promise<{ command: string; env: Record<string, string>; currentAgent: Agent } | null> {
  const currentAgent: Agent = {
    ...options.mergedAgent,
    commands: {
      ...options.mergedAgent.commands,
      ...(options.fallback?.commands || {}),
    },
    env: {
      ...options.mergedAgent.env,
      ...(options.fallback?.env || {}),
    },
  };

  let initialCommand = currentAgent.commands?.new ?? '';
  const env = {
    ...process.env,
    CLAW_CLI_MESSAGE: options.message,
  } as Record<string, string>;

  applyEnvOverrides(env, currentAgent.env);

  if (!options.isNewSession && currentAgent.commands?.append) {
    initialCommand = currentAgent.commands.append;
    applyEnvOverrides(env, options.agentSessionSettings?.env);
  }

  if (!initialCommand) {
    return null;
  }

  const agentSpecificEnvKeys = getActiveEnvKeys(
    currentAgent.env,
    !options.isNewSession ? options.agentSessionSettings?.env : undefined
  );
  agentSpecificEnvKeys.add('CLAW_CLI_MESSAGE');

  Object.assign(env, options.routerEnv);
  Object.keys(options.routerEnv).forEach((k) => agentSpecificEnvKeys.add(k));

  const apiCtx = getApiContext(options.settings);
  if (apiCtx) {
    const proxyUrl = apiCtx.proxy_host
      ? `${apiCtx.proxy_host}:${apiCtx.port}`
      : `http://${apiCtx.host}:${apiCtx.port}`;
    env['CLAW_API_URL'] = proxyUrl;
    agentSpecificEnvKeys.add('CLAW_API_URL');

    const token = generateToken({
      chatId: options.chatId,
      agentId: options.agentId,
      sessionId: options.finalSessionId,
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
    options.executionCwd,
    options.cwd
  );

  return { command, env, currentAgent };
}
