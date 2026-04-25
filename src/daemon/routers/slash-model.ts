import type { RouterState } from './types.js';
import type { Agent } from '../../shared/config.js';
import {
  getAgent,
  getAgentOverlay,
  updateAgentOverlay,
  getWorkspaceRoot,
} from '../../shared/workspace.js';

const RESERVED_SHORTHANDS = new Set(['help', 'add', 'remove', 'rm']);

function stop(state: RouterState, reply: string): RouterState {
  return { ...state, message: '', reply, action: 'stop' };
}

function formatHelp(): string {
  return [
    'Usage:',
    '  /model                              List current model and shorthands.',
    '  /model <name>                       Set MODEL (resolves shorthand if defined).',
    '  /model add <shorthand> <full-name>  Add or replace a shorthand.',
    '  /model remove <shorthand>           Remove a shorthand (alias: rm).',
    '  /model help                         Show this help.',
  ].join('\n');
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

// Heuristic: a token that looks like a short, undecorated word a user might
// reasonably mistake for a shorthand. Real model names typically contain at
// least one separator (e.g. `gemini-3-pro`, `claude-opus-4-7`, `gpt-4.1`).
function looksLikeShorthand(name: string): boolean {
  return name.length <= 16 && !/[-./:]/.test(name);
}

async function setModel(agentId: string, fullModel: string, workspaceRoot: string): Promise<void> {
  await updateAgentOverlay(
    agentId,
    (overlay) => {
      const nextEnv = { ...(overlay.env ?? {}), MODEL: fullModel };
      return { ...overlay, env: nextEnv };
    },
    workspaceRoot
  );
}

async function addShorthand(
  agentId: string,
  shorthand: string,
  fullModel: string,
  workspaceRoot: string
): Promise<void> {
  await updateAgentOverlay(
    agentId,
    (overlay) => {
      const nextShorthands = { ...(overlay.modelShorthands ?? {}), [shorthand]: fullModel };
      return { ...overlay, modelShorthands: nextShorthands };
    },
    workspaceRoot
  );
}

async function removeOverlayShorthand(
  agentId: string,
  shorthand: string,
  workspaceRoot: string
): Promise<boolean> {
  return await updateAgentOverlay(
    agentId,
    (overlay) => {
      const overlayShorthands = overlay.modelShorthands ?? {};
      if (!(shorthand in overlayShorthands)) return null;
      const next = { ...overlayShorthands };
      delete next[shorthand];
      const updated: Agent = { ...overlay };
      if (Object.keys(next).length === 0) {
        delete updated.modelShorthands;
      } else {
        updated.modelShorthands = next;
      }
      return updated;
    },
    workspaceRoot
  );
}

async function ensureOverlay(
  state: RouterState,
  agentId: string,
  workspaceRoot: string
): Promise<RouterState | null> {
  const overlay = await getAgentOverlay(agentId, workspaceRoot);
  if (overlay !== null) return null;
  return stop(state, `Agent '${agentId}' has no settings overlay; cannot configure model.`);
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

  const firstSpace = rest.search(/\s/);
  const subcommand = firstSpace === -1 ? rest : rest.slice(0, firstSpace);
  const remainder = firstSpace === -1 ? '' : rest.slice(firstSpace + 1).trim();

  if (subcommand === 'help') {
    return stop(state, formatHelp());
  }

  if (subcommand === 'add') {
    // Require a single-token full name. Model identifiers don't contain
    // whitespace, and accepting trailing tokens silently swallows typos
    // (e.g. `/model add foo gemini-3 pro` storing `MODEL=gemini-3 pro`).
    const addMatch = remainder.match(/^(\S+)\s+(\S+)\s*$/);
    if (!addMatch) {
      return stop(state, 'Usage: /model add <shorthand> <full-name>');
    }
    const shorthand = addMatch[1]!;
    const fullModel = addMatch[2]!;
    if (RESERVED_SHORTHANDS.has(shorthand)) {
      return stop(state, `Invalid shorthand: '${shorthand}' is reserved.`);
    }
    const guard = await ensureOverlay(state, agentId, workspaceRoot);
    if (guard) return guard;
    await addShorthand(agentId, shorthand, fullModel, workspaceRoot);
    return stop(state, `Added shorthand: ${shorthand} -> ${fullModel}`);
  }

  if (subcommand === 'remove' || subcommand === 'rm') {
    if (!/^\S+$/.test(remainder)) {
      return stop(state, 'Usage: /model remove <shorthand>');
    }
    const guard = await ensureOverlay(state, agentId, workspaceRoot);
    if (guard) return guard;
    const removed = await removeOverlayShorthand(agentId, remainder, workspaceRoot);
    if (!removed) {
      const merged = await getAgent(agentId, workspaceRoot);
      if (merged?.modelShorthands?.[remainder] !== undefined) {
        return stop(
          state,
          `Shorthand '${remainder}' is defined in the template, not the overlay. Edit the template to remove it.`
        );
      }
      return stop(state, `Shorthand '${remainder}' not found.`);
    }
    const merged = await getAgent(agentId, workspaceRoot);
    const fallback = merged?.modelShorthands?.[remainder];
    const note = fallback !== undefined ? ` (still resolves to '${fallback}' from template)` : '';
    return stop(state, `Removed shorthand: ${remainder}${note}.`);
  }

  if (subcommand.startsWith('-')) {
    return stop(state, `Unknown option: ${subcommand}\n${formatHelp()}`);
  }

  // Bare model name / shorthand. Reject extra args so a typoed subcommand like
  // `/model rmove flash` doesn't get stored as MODEL=rmove.
  if (remainder !== '') {
    return stop(state, `Unknown subcommand: ${subcommand}\n${formatHelp()}`);
  }

  const guard = await ensureOverlay(state, agentId, workspaceRoot);
  if (guard) return guard;

  const agent = await getAgent(agentId, workspaceRoot);
  const shorthands = agent?.modelShorthands ?? {};
  const matched = Object.prototype.hasOwnProperty.call(shorthands, subcommand);
  const fullModel = matched ? shorthands[subcommand]! : subcommand;
  await setModel(agentId, fullModel, workspaceRoot);

  if (matched) {
    return stop(state, `Set MODEL to ${fullModel} (shorthand '${subcommand}').`);
  }
  if (looksLikeShorthand(subcommand)) {
    return stop(
      state,
      `Set MODEL to ${fullModel}. (No shorthand matched — was that the literal model name? Run /model add ${subcommand} <full-name> if not.)`
    );
  }
  return stop(state, `Set MODEL to ${fullModel}.`);
}
