import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getClawminiDir } from '../shared/workspace.js';
import type { Delegation } from '../shared/delegations.js';

export function getDelegationsDir(chatId: string): string {
  return path.join(getClawminiDir(), 'tmp', 'delegations', chatId);
}

export function getDelegationPath(chatId: string, id: string): string {
  return path.join(getDelegationsDir(chatId), `${id}.json`);
}

function generateId(): string {
  return crypto.randomBytes(3).toString('base64url').replace(/[-_]/g, '').slice(0, 3).toLowerCase();
}

export class DelegationStore {
  async save(delegation: Delegation): Promise<void> {
    const dir = getDelegationsDir(delegation.chatId);
    await fs.mkdir(dir, { recursive: true });

    const filePath = getDelegationPath(delegation.chatId, delegation.id);
    const tmpPath = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;

    await fs.writeFile(tmpPath, JSON.stringify(delegation, null, 2), 'utf-8');
    await fs.rename(tmpPath, filePath);
  }

  async load(chatId: string, id: string): Promise<Delegation | null> {
    const filePath = getDelegationPath(chatId, id);
    try {
      const data = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(data) as Delegation;
    } catch (err: unknown) {
      const e = err as { code?: string };
      if (e.code === 'ENOENT') {
        return null;
      }
      throw e;
    }
  }

  async list(chatId: string): Promise<Delegation[]> {
    const dir = getDelegationsDir(chatId);
    try {
      const files = await fs.readdir(dir);
      const delegations: Delegation[] = [];
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const id = file.slice(0, -5);
        const del = await this.load(chatId, id);
        if (del) {
          delegations.push(del);
        }
      }
      return delegations;
    } catch (err: unknown) {
      const e = err as { code?: string };
      if (e.code === 'ENOENT') {
        return [];
      }
      throw e;
    }
  }

  async delete(chatId: string, id: string): Promise<void> {
    const filePath = getDelegationPath(chatId, id);
    try {
      await fs.unlink(filePath);
    } catch (err: unknown) {
      const e = err as { code?: string };
      if (e.code !== 'ENOENT') {
        throw e;
      }
    }
  }

  async createUniqueId(chatId: string): Promise<string> {
    let attempts = 0;
    while (attempts < 10) {
      const id = generateId();
      const exists = existsSync(getDelegationPath(chatId, id));
      if (!exists) return id;
      attempts++;
    }
    throw new Error('Failed to generate a unique delegation ID');
  }
}
