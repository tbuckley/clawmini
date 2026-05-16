import fs from 'fs/promises';
import path from 'path';
import { randomInt } from 'crypto';
import { getClawminiDir } from '../shared/workspace.js';
import {
  type Delegation,
  type DelegationKind,
  type DelegationState,
  type DelegationSubscription,
  DelegationSchema,
  DelegationSubscriptionSchema,
} from '../shared/delegations.js';

function isENOENT(err: unknown): boolean {
  return Boolean(
    err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'ENOENT'
  );
}

export interface DelegationListFilter {
  state?: DelegationState | DelegationState[];
  kind?: DelegationKind;
  parentId?: string;
}

// Thin file-IO layer for delegation records. Cross-kind coordination
// (state-machine transitions, event emission, wait/subscribe) lives on
// `DelegationManager` (added in Ticket 1) — this class only knows how to
// read/write JSON files. Mirrors the style of `request-store.ts`.
export class DelegationStore {
  private baseDir: string;

  constructor(startDir = process.cwd()) {
    this.baseDir = path.join(getClawminiDir(startDir), 'tmp', 'delegations');
  }

  private chatDir(chatId: string): string {
    return path.join(this.baseDir, chatId);
  }

  private filePath(chatId: string, id: string): string {
    return path.join(this.chatDir(chatId), `${id}.json`);
  }

  private subscriptionsDir(chatId: string): string {
    return path.join(this.chatDir(chatId), 'subscriptions');
  }

  private subscriptionPath(chatId: string, subscriptionId: string): string {
    return path.join(this.subscriptionsDir(chatId), `${subscriptionId}.json`);
  }

  async save(delegation: Delegation): Promise<void> {
    const dir = this.chatDir(delegation.chatId);
    await fs.mkdir(dir, { recursive: true });
    const filePath = this.filePath(delegation.chatId, delegation.id);
    await fs.writeFile(filePath, JSON.stringify(delegation, null, 2), 'utf8');
  }

  async load(chatId: string, id: string): Promise<Delegation | null> {
    const filePath = this.filePath(chatId, id);
    let raw: string;
    try {
      raw = await fs.readFile(filePath, 'utf8');
    } catch (err: unknown) {
      if (isENOENT(err)) return null;
      throw err;
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Corrupt delegation file at ${filePath}: ${msg}`, { cause: err });
    }

    const parsed = DelegationSchema.safeParse(parsedJson);
    if (!parsed.success) {
      throw new Error(`Corrupt delegation file at ${filePath}: ${parsed.error.message}`, {
        cause: parsed.error,
      });
    }
    return parsed.data as Delegation;
  }

  async list(chatId: string, filter: DelegationListFilter = {}): Promise<Delegation[]> {
    const dir = this.chatDir(chatId);
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch (err: unknown) {
      if (isENOENT(err)) return [];
      throw err;
    }

    const states = filter.state
      ? Array.isArray(filter.state)
        ? filter.state
        : [filter.state]
      : null;

    const results: Delegation[] = [];
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      const id = path.basename(entry, '.json');
      const record = await this.load(chatId, id);
      if (!record) continue;
      if (filter.kind && record.kind !== filter.kind) continue;
      if (states && !states.includes(record.state)) continue;
      if (filter.parentId !== undefined && record.parentId !== filter.parentId) continue;
      results.push(record);
    }
    // Newest first by createdAt — caller can re-sort if it cares.
    results.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    return results;
  }

  async delete(chatId: string, id: string): Promise<void> {
    const filePath = this.filePath(chatId, id);
    try {
      await fs.unlink(filePath);
    } catch (err: unknown) {
      if (!isENOENT(err)) throw err;
    }
  }

  // Locate a delegation by id alone by walking the chat-id subdirs. Used by
  // `DelegationManager.approve` / `reject` / `markResolved`, which the spec
  // addresses by id only (§5.6 "Module shape"). Returns null when no chat
  // dir contains the id. Linear in the number of chat dirs; if a future
  // workload makes that hot, the manager can keep a (chatId → ids) cache.
  async findById(id: string): Promise<Delegation | null> {
    let chatDirs: string[];
    try {
      chatDirs = await fs.readdir(this.baseDir);
    } catch (err: unknown) {
      if (isENOENT(err)) return null;
      throw err;
    }
    for (const chatId of chatDirs) {
      const record = await this.load(chatId, id);
      if (record) return record;
    }
    return null;
  }

  // Generate a unique id for `chatId`. 3-char `[0-9a-z]` by default; grows to
  // 4+ chars when the chat directory already contains every 3-char id we
  // happen to roll. Mirrors the collision-grow idiom from `request-store.ts`
  // (which uses 3 chars + caller-side retry) — here we just keep the retry
  // self-contained.
  //
  // `attemptsBeforeGrow` defaults to the namespace size at the current length
  // (36 ** length), which is the threshold we'd expect to be saturated after.
  // `randomFn` overrides the random-id generator. Both are injected by tests
  // to verify grow behavior without seeding tens of thousands of files.
  async generateId(
    chatId: string,
    opts: {
      attemptsBeforeGrow?: (length: number) => number;
      randomFn?: (length: number) => string;
    } = {}
  ): Promise<string> {
    const attemptsBeforeGrow = opts.attemptsBeforeGrow ?? ((length) => 36 ** length);
    const randomFn = opts.randomFn ?? randomAlphaNumericLower;
    let length = 3;
    let attemptsAtLength = 0;
    while (true) {
      const candidate = randomFn(length);
      const filePath = this.filePath(chatId, candidate);
      try {
        await fs.access(filePath);
        attemptsAtLength++;
        if (attemptsAtLength >= attemptsBeforeGrow(length)) {
          length++;
          attemptsAtLength = 0;
        }
      } catch (err: unknown) {
        if (isENOENT(err)) return candidate;
        throw err;
      }
    }
  }

  async saveSubscription(sub: DelegationSubscription): Promise<void> {
    const dir = this.subscriptionsDir(sub.chatId);
    await fs.mkdir(dir, { recursive: true });
    const filePath = this.subscriptionPath(sub.chatId, sub.subscriptionId);
    await fs.writeFile(filePath, JSON.stringify(sub, null, 2), 'utf8');
  }

  async loadSubscription(
    chatId: string,
    subscriptionId: string
  ): Promise<DelegationSubscription | null> {
    const filePath = this.subscriptionPath(chatId, subscriptionId);
    let raw: string;
    try {
      raw = await fs.readFile(filePath, 'utf8');
    } catch (err: unknown) {
      if (isENOENT(err)) return null;
      throw err;
    }
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Corrupt subscription file at ${filePath}: ${msg}`, { cause: err });
    }
    const parsed = DelegationSubscriptionSchema.safeParse(parsedJson);
    if (!parsed.success) {
      throw new Error(`Corrupt subscription file at ${filePath}: ${parsed.error.message}`, {
        cause: parsed.error,
      });
    }
    return parsed.data as DelegationSubscription;
  }

  async listSubscriptions(chatId: string): Promise<DelegationSubscription[]> {
    const dir = this.subscriptionsDir(chatId);
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch (err: unknown) {
      if (isENOENT(err)) return [];
      throw err;
    }
    const results: DelegationSubscription[] = [];
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      const subscriptionId = path.basename(entry, '.json');
      const sub = await this.loadSubscription(chatId, subscriptionId);
      if (sub) results.push(sub);
    }
    return results;
  }

  async deleteSubscription(chatId: string, subscriptionId: string): Promise<void> {
    const filePath = this.subscriptionPath(chatId, subscriptionId);
    try {
      await fs.unlink(filePath);
    } catch (err: unknown) {
      if (!isENOENT(err)) throw err;
    }
  }

  // Recursively remove the entire `.clawmini/tmp/delegations/` tree —
  // including every chat subdir and the per-chat `subscriptions/` dirs.
  // Called by `DelegationManager.wipeAll()` on daemon start.
  async wipeAll(): Promise<void> {
    await fs.rm(this.baseDir, { recursive: true, force: true });
  }
}

function randomAlphaNumericLower(length: number): string {
  const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[randomInt(chars.length)];
  }
  return result;
}
