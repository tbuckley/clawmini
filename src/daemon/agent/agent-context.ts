import { type FallbackSchema } from '../../shared/config.js';
import {
  getActiveEnvironmentInfo,
  getEnvironmentSearchDirs,
  readEnvironment,
  substituteLayeredEnvDir,
} from '../../shared/workspace.js';
import { z } from 'zod';

export type Fallback = z.infer<typeof FallbackSchema>;

function formatEnvironmentPrefix(
  prefix: string,
  searchDirs: string[],
  replacements: { targetPath: string; executionCwd: string; envArgs: string }
): string {
  let out = substituteLayeredEnvDir(prefix, searchDirs);
  const map: Record<string, string> = {
    '{WORKSPACE_DIR}': replacements.targetPath,
    '{AGENT_DIR}': replacements.executionCwd,
    '{HOME_DIR}': process.env.HOME || '',
    '{ENV_ARGS}': replacements.envArgs,
  };
  out = out.replace(
    /{(WORKSPACE_DIR|AGENT_DIR|HOME_DIR|ENV_ARGS)}/g,
    (match) => map[match] || match
  );
  return out;
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
  const searchDirs = await getEnvironmentSearchDirs(activeEnvName, cwd);

  if (activeEnv?.env) {
    for (const [key, value] of Object.entries(activeEnv.env)) {
      if (value === false) {
        delete env[key];
        agentSpecificEnvKeys.delete(key);
      } else {
        let interpolatedValue = String(value);
        interpolatedValue = interpolatedValue.replace(/\{PATH\}/g, process.env.PATH || '');
        interpolatedValue = substituteLayeredEnvDir(interpolatedValue, searchDirs);
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

    const prefixReplaced = formatEnvironmentPrefix(activeEnv.prefix, searchDirs, {
      targetPath: activeEnvInfo.targetPath,
      executionCwd: executionCwd,
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
