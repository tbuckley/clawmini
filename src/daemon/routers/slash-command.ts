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

    const targetPathMd = path.resolve(commandsDir, `${commandName}.md`);
    const targetPathTxt = path.resolve(commandsDir, `${commandName}.txt`);

    // Strict path traversal protection
    const baseTargetPath = path.resolve(commandsDir, commandName);
    if (!pathIsInsideDir(baseTargetPath, commandsDir)) {
      continue;
    }

    let content: string;

    try {
      content = await fs.readFile(targetPathMd, 'utf8');
    } catch {
      try {
        content = await fs.readFile(targetPathTxt, 'utf8');
      } catch {
        // If file doesn't exist or can't be read, leave it as is.
        continue;
      }
    }

    // Replace the command with the content. We only replace the exact occurrence.
    // Since replace replaces the first occurrence, and we are iterating over all matches,
    // it should replace them sequentially. If there are multiple identical commands,
    // it's fine, each will be replaced in turn.
    currentMessage = currentMessage.replace(fullMatch, content.trim());
  }

  return {
    ...state,
    message: currentMessage,
  };
}
