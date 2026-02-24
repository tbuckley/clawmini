import fs from 'node:fs';
import path from 'node:path';

export function getWorkspaceRoot(startDir = process.cwd()): string {
  let curr = startDir;
  while (curr !== path.parse(curr).root) {
    if (fs.existsSync(path.join(curr, '.clawmini'))) {
      return curr;
    }
    if (fs.existsSync(path.join(curr, 'package.json')) || fs.existsSync(path.join(curr, '.git'))) {
      return curr;
    }
    curr = path.dirname(curr);
  }
  return startDir;
}

export function getClawminiDir(startDir = process.cwd()): string {
  return path.join(getWorkspaceRoot(startDir), '.clawmini');
}

export function getSocketPath(startDir = process.cwd()): string {
  return path.join(getClawminiDir(startDir), 'server.sock');
}

export function getSettingsPath(startDir = process.cwd()): string {
  return path.join(getClawminiDir(startDir), 'settings.json');
}
