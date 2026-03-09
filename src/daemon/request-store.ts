import fs from 'fs/promises';
import path from 'path';
import { getClawminiDir } from '../shared/workspace.js';
import type { PolicyRequest } from '../shared/policies.js';

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
    const filePath = this.getFilePath(request.id);
    await fs.writeFile(filePath, JSON.stringify(request, null, 2), 'utf8');
  }

  async load(id: string): Promise<PolicyRequest | null> {
    const filePath = this.getFilePath(id);
    try {
      const data = await fs.readFile(filePath, 'utf8');
      return JSON.parse(data) as PolicyRequest;
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
