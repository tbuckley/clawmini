import fs from 'node:fs/promises';
import path from 'node:path';
import type { RouterState } from './types.js';
import { getClawminiDir } from '../../shared/workspace.js';
import { pathIsInsideDir } from '../../shared/utils/fs.js';

export async function slashCommand(state: RouterState): Promise<RouterState> {
  const commandsDir = path.resolve(getClawminiDir(), 'commands');
  let currentMessage = state.message;

  // Regex to match slash commands (e.g., /foo or /foo:bar) that appear as whole words.
  // We use lookbehind and lookahead to ensure it's bounded by whitespace or string start/end.
  const commandRegex = /(?<=^|\s)\/([a-zA-Z0-9_\-:.]+)(?=\s|$)/g;
  const matches = [...currentMessage.matchAll(commandRegex)];

  if (matches.length === 0) {
    return state;
  }

  for (const match of matches) {
    const fullMatch = match[0];
    const commandName = match[1];
    if (!commandName) continue;

    const targetPath = path.resolve(commandsDir, commandName);

    // Strict path traversal protection
    if (!pathIsInsideDir(targetPath, commandsDir)) {
      continue;
    }

    try {
      const content = await fs.readFile(targetPath, 'utf8');
      // Replace the command with the content. We only replace the exact occurrence.
      // Since replace replaces the first occurrence, and we are iterating over all matches,
      // it should replace them sequentially. If there are multiple identical commands,
      // it's fine, each will be replaced in turn.
      currentMessage = currentMessage.replace(fullMatch, content.trim());
    } catch {
      // If file doesn't exist or can't be read, leave it as is.
      continue;
    }
  }

  return {
    ...state,
    message: currentMessage,
  };
}
