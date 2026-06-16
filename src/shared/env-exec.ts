import { getEnvironmentPath, getWorkspaceRoot, readEnvironment } from './workspace.js';

export interface WrappedCommand {
  command: string;
  env: Record<string, string>;
}

export interface WrapOptions {
  workspaceDir?: string;
  agentDir?: string;
  startDir?: string;
}

/**
 * Produce the shell command + env vars that would be used to run `command`
 * inside the named environment, applying the same `prefix`/`env`
 * interpolation rules as the daemon-side execution path but without
 * consulting `.clawmini/settings.json`'s path→env mapping.
 */
export async function wrapCommandForEnvironment(
  envName: string,
  command: string,
  options: WrapOptions = {}
): Promise<WrappedCommand> {
  const startDir = options.startDir ?? process.cwd();
  const workspaceRoot = getWorkspaceRoot(startDir);
  const workspaceDir = options.workspaceDir ?? workspaceRoot;
  const agentDir = options.agentDir ?? workspaceDir;

  const envConfig = await readEnvironment(envName, startDir);
  if (!envConfig) {
    throw new Error(`Environment not found: ${envName}`);
  }

  const envDir = getEnvironmentPath(envName, startDir);

  const envVars: Record<string, string> = {};
  if (envConfig.env) {
    for (const [key, value] of Object.entries(envConfig.env)) {
      if (value === false) continue;
      const raw = String(value);
      envVars[key] = raw
        .replace(/\{PATH\}/g, process.env.PATH || '')
        .replace(/\{ENV_DIR\}/g, envDir)
        .replace(/\{WORKSPACE_DIR\}/g, workspaceDir);
    }
  }

  let wrapped = command;
  if (envConfig.prefix) {
    const replacements: Record<string, string> = {
      '{WORKSPACE_DIR}': workspaceDir,
      '{AGENT_DIR}': agentDir,
      '{ENV_DIR}': envDir,
      '{HOME_DIR}': process.env.HOME || '',
      '{ENV_ARGS}': '',
    };
    const prefix = envConfig.prefix.replace(
      /{(WORKSPACE_DIR|AGENT_DIR|ENV_DIR|HOME_DIR|ENV_ARGS)}/g,
      (match) => replacements[match] ?? match
    );
    wrapped = prefix.includes('{COMMAND}')
      ? prefix.replace('{COMMAND}', command)
      : `${prefix} ${command}`;
  }

  return { command: wrapped, env: envVars };
}
