import { spawn } from 'node:child_process';
import type { RouterState } from './routers/types.js';
import { slashNew } from './routers/slash-new.js';
import { slashCommand } from './routers/slash-command.js';
import { slashStop } from './routers/slash-stop.js';
import { slashInterrupt } from './routers/slash-interrupt.js';
import { slashPolicies } from './routers/slash-policies.js';

export async function executeRouterPipeline(
  initialState: RouterState,
  routers: string[]
): Promise<RouterState> {
  let state = await slashPolicies({ ...initialState });

  if (state.action === 'stop') {
    return state;
  }

  for (const router of routers) {
    if (router === '@clawmini/slash-new') {
      state = slashNew(state);
    } else if (router === '@clawmini/slash-command') {
      state = await slashCommand(state);
    } else if (router === '@clawmini/slash-stop') {
      state = slashStop(state);
    } else if (router === '@clawmini/slash-interrupt') {
      state = slashInterrupt(state);
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
