import type { RouterState } from './types.js';
import type { Agent } from '../../shared/config.js';
import {
  getAgent,
  getAgentOverlay,
  writeAgentSettings,
  getWorkspaceRoot,
} from '../../shared/workspace.js';

function stop(state: RouterState, reply: string): RouterState {
  return { ...state, message: '', reply, action: 'stop' };
}

function formatList(agent: Agent | null): string {
  const current = (agent?.env?.MODEL as string | undefined) ?? '(unset)';
  const shorthands = agent?.modelShorthands ?? {};
  const entries = Object.entries(shorthands);
  const lines = [`Current model: ${current}`];
  if (entries.length === 0) {
    lines.push('No shorthands defined. Add one with /model add <shorthand> <full-name>.');
  } else {
    lines.push('Shorthands:');
    for (const [short, full] of entries.sort(([a], [b]) => a.localeCompare(b))) {
      lines.push(`- ${short} -> ${full}`);
    }
  }
  return lines.join('\n');
}

async function setModel(agentId: string, fullModel: string, workspaceRoot: string): Promise<void> {
  const overlay = (await getAgentOverlay(agentId, workspaceRoot)) ?? {};
  const nextEnv = { ...(overlay.env ?? {}), MODEL: fullModel };
  await writeAgentSettings(agentId, { ...overlay, env: nextEnv }, workspaceRoot);
}

async function addShorthand(
  agentId: string,
  shorthand: string,
  fullModel: string,
  workspaceRoot: string
): Promise<void> {
  const overlay = (await getAgentOverlay(agentId, workspaceRoot)) ?? {};
  const nextShorthands = { ...(overlay.modelShorthands ?? {}), [shorthand]: fullModel };
  await writeAgentSettings(agentId, { ...overlay, modelShorthands: nextShorthands }, workspaceRoot);
}

export async function slashModel(state: RouterState): Promise<RouterState> {
  const message = state.message.trim();
  if (!/^\/model(\s|$)/.test(message)) return state;

  const agentId = state.agentId;
  if (!agentId) {
    return stop(state, '/model requires an agent. Set a defaultAgent for this chat.');
  }

  const workspaceRoot = getWorkspaceRoot();
  const rest = message.slice('/model'.length).trim();

  if (rest === '') {
    const agent = await getAgent(agentId, workspaceRoot);
    return stop(state, formatList(agent));
  }

  const addMatch = rest.match(/^add\s+(\S+)\s+(\S.*)$/);
  if (addMatch) {
    const shorthand = addMatch[1]!;
    const fullModel = addMatch[2]!.trim();
    if (shorthand === 'add') {
      return stop(state, `Invalid shorthand: '${shorthand}' is reserved.`);
    }
    await addShorthand(agentId, shorthand, fullModel, workspaceRoot);
    return stop(state, `Added shorthand: ${shorthand} -> ${fullModel}`);
  }

  if (/^add(\s|$)/.test(rest)) {
    return stop(state, 'Usage: /model add <shorthand> <full-name>');
  }

  const agent = await getAgent(agentId, workspaceRoot);
  const shorthands = agent?.modelShorthands ?? {};
  const fullModel = shorthands[rest] ?? rest;
  await setModel(agentId, fullModel, workspaceRoot);
  const note = shorthands[rest] ? ` (shorthand '${rest}')` : '';
  return stop(state, `Set MODEL to ${fullModel}${note}.`);
}
