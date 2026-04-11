import fs from 'fs/promises';
import path from 'path';
import { z } from 'zod';
import { getClawminiDir } from '../shared/workspace.js';
import type { PolicyRequest } from '../shared/policies.js';
import { randomInt } from 'crypto';

const PolicyRequestSchema = z.object({
  id: z.string(),
  commandName: z.string(),
  args: z.array(z.string()),
  fileMappings: z.record(z.string(), z.string()),
  state: z.enum(['Pending', 'Approved', 'Rejected']),
  createdAt: z.number(),
  rejectionReason: z.string().optional(),
  chatId: z.string(),
  agentId: z.string(),
  subagentId: z.string().optional(),
});

function isENOENT(err: unknown): boolean {
  return Boolean(
    err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'ENOENT'
  );
}

export class RequestStore {
  private baseDir: string;

  constructor(startDir = process.cwd()) {
    this.baseDir = path.join(getClawminiDir(startDir), 'tmp', 'requests');
  }

  async init(): Promise<void> {
    await fs.mkdir(this.baseDir, { recursive: true });
  }

  private getFilePath(id: string): string {
    return path.join(this.baseDir, `${id}.json`);
  }

  async save(request: PolicyRequest): Promise<void> {
    await this.init();
    const normalizedId = normalizePolicyId(request.id);
    request.id = normalizedId;
    const filePath = this.getFilePath(normalizedId);
    await fs.writeFile(filePath, JSON.stringify(request, null, 2), 'utf8');
  }

  async load(id: string): Promise<PolicyRequest | null> {
    const normalizedId = normalizePolicyId(id);
    const filePath = this.getFilePath(normalizedId);
    try {
      const data = await fs.readFile(filePath, 'utf8');
      return PolicyRequestSchema.parse(JSON.parse(data)) as PolicyRequest;
    } catch (err: unknown) {
      if (isENOENT(err)) {
        return null;
      }
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`Failed to parse request file ${filePath}:`, msg);
      return null;
    }
  }

  async list(): Promise<PolicyRequest[]> {
    await this.init();
    const requests: PolicyRequest[] = [];
    try {
      const files = await fs.readdir(this.baseDir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const id = path.basename(file, '.json');
        const req = await this.load(id);
        if (req) {
          requests.push(req);
        }
      }
    } catch (err: unknown) {
      if (!isENOENT(err)) {
        throw err;
      }
    }
    return requests.sort((a, b) => b.createdAt - a.createdAt);
  }
}

export function generateRandomAlphaNumericString(length: number): string {
  const characters = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += characters[Math.floor(randomInt(characters.length))];
  }
  return result;
}

function normalizePolicyId(id: string): string {
  return id.toLocaleUpperCase().trim();
}
