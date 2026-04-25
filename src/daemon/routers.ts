import { spawn } from 'node:child_process';
import type { RouterState } from './routers/types.js';
import { slashNew } from './routers/slash-new.js';
import { slashCommand } from './routers/slash-command.js';
import { slashStop } from './routers/slash-stop.js';
import { slashInterrupt } from './routers/slash-interrupt.js';
import { slashPolicies } from './routers/slash-policies.js';
import { slashModel } from './routers/slash-model.js';
import { createSessionTimeoutRouter } from './routers/session-timeout.js';
import type { RouterConfig } from '../shared/config.js';

export const GLOBAL_ROUTERS: RouterConfig[] = ['@clawmini/session-timeout'];

export const USER_ROUTERS: RouterConfig[] = [
  '@clawmini/slash-new',
  '@clawmini/slash-command',
  '@clawmini/slash-stop',
  '@clawmini/slash-interrupt',
  '@clawmini/slash-policies',
  '@clawmini/slash-model',
];

export function resolveRouters(
  userRouters: RouterConfig[],
  isUserMessage: boolean
): RouterConfig[] {
  const resolvedGlobals: RouterConfig[] = [];
  const resolvedUsers: RouterConfig[] = [];

  const userConfigMap = new Map<string, unknown>();
  for (const r of userRouters) {
    const name = typeof r === 'string' ? r : r.use;
    const config = typeof r === 'string' ? {} : r.with || {};

    if (name.startsWith('@clawmini/')) {
      userConfigMap.set(name, config);
    } else {
      resolvedUsers.push(r);
    }
  }

  for (const globalRouter of GLOBAL_ROUTERS) {
    const name = typeof globalRouter === 'string' ? globalRouter : globalRouter.use;
    const baseConfig = typeof globalRouter === 'string' ? {} : globalRouter.with || {};
    const userConfig = userConfigMap.get(name) || {};
    const mergedConfig = { ...baseConfig, ...userConfig };

    resolvedGlobals.push({ use: name, with: mergedConfig });
  }

  const defaultUserRouters: RouterConfig[] = [];
  for (const defaultUserRouter of USER_ROUTERS) {
    const name = typeof defaultUserRouter === 'string' ? defaultUserRouter : defaultUserRouter.use;
    const baseConfig = typeof defaultUserRouter === 'string' ? {} : defaultUserRouter.with || {};
    const userConfig = userConfigMap.get(name) || {};
    const mergedConfig = { ...baseConfig, ...userConfig };

    defaultUserRouters.push({ use: name, with: mergedConfig });
  }

  if (isUserMessage) {
    return [...resolvedGlobals, ...defaultUserRouters, ...resolvedUsers];
  } else {
    return resolvedGlobals;
  }
}

export async function executeRouterPipeline(
  initialState: RouterState,
  routers: RouterConfig[]
): Promise<RouterState> {
  let state = { ...initialState };

  for (const routerDef of routers) {
    if (state.action === 'stop') {
      break;
    }

    const router = typeof routerDef === 'string' ? routerDef : routerDef.use;
    const config = typeof routerDef === 'string' ? {} : routerDef.with || {};

    if (router === '@clawmini/slash-new') {
      state = slashNew(state);
    } else if (router === '@clawmini/slash-command') {
      state = await slashCommand(state);
    } else if (router === '@clawmini/slash-stop') {
      state = slashStop(state);
    } else if (router === '@clawmini/slash-interrupt') {
      state = slashInterrupt(state);
    } else if (router === '@clawmini/slash-policies') {
      state = await slashPolicies(state);
    } else if (router === '@clawmini/slash-model') {
      state = await slashModel(state);
    } else if (router === '@clawmini/session-timeout') {
      state = createSessionTimeoutRouter(config)(state);
    } else {
      // Execute as custom shell command
      try {
        state = await executeCustomRouter(router, state);
      } catch (err) {
        // Silent failure handling: log but do not halt
        console.error(`Router error [${router}]:`, err);
      }
    }
  }

  return state;
}

async function executeCustomRouter(command: string, state: RouterState): Promise<RouterState> {
  return new Promise((resolve, reject) => {
    // We run the command via shell
    const child = spawn(command, { shell: true });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    // timeout fallback to avoid hanging indefinitely
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Router execution timed out'));
    }, 10000);

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        return reject(new Error(`Process exited with code ${code}. Stderr: ${stderr}`));
      }

      try {
        const result = JSON.parse(stdout);
        const newState = { ...state };

        if (typeof result.message === 'string') newState.message = result.message;
        if (typeof result.agent === 'string') newState.agentId = result.agent;
        if (typeof result.session === 'string') newState.sessionId = result.session;
        if (typeof result.env === 'object' && result.env !== null) {
          newState.env = { ...newState.env, ...result.env };
        }
        if (typeof result.reply === 'string') newState.reply = result.reply;
        if (typeof result.action === 'string') newState.action = result.action;

        resolve(newState);
      } catch (err) {
        reject(new Error(`Failed to parse router output: ${err}. Stdout: ${stdout}`));
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    // Write state to stdin
    const inputState = {
      message: state.message,
      chatId: state.chatId,
      agentId: state.agentId,
      sessionId: state.sessionId,
      env: state.env,
      action: state.action,
    };

    if (child.stdin) {
      child.stdin.on('error', (err) => {
        if ((err as NodeJS.ErrnoException).code !== 'EPIPE') {
          console.error('stdin error:', err);
        }
      });
      child.stdin.write(JSON.stringify(inputState));
      child.stdin.end();
    }
  });
}
