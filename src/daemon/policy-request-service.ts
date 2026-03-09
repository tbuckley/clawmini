import { randomUUID } from 'node:crypto';
import { RequestStore } from './request-store.js';
import { createSnapshot, interpolateArgs } from './policy-utils.js';
import type { PolicyRequest } from '../shared/policies.js';

export class PolicyRequestService {
  private store: RequestStore;
  private maxPending: number;
  private workspaceRoot: string;
  private snapshotDir: string;

  constructor(store: RequestStore, workspaceRoot: string, snapshotDir: string, maxPending = 100) {
    this.store = store;
    this.workspaceRoot = workspaceRoot;
    this.snapshotDir = snapshotDir;
    this.maxPending = maxPending;
  }

  async createRequest(
    commandName: string,
    args: string[],
    fileMappings: Record<string, string>
  ): Promise<PolicyRequest> {
    const allRequests = await this.store.list();
    const pendingCount = allRequests.filter((r) => r.state === 'Pending').length;

    if (pendingCount >= this.maxPending) {
      throw new Error(`Maximum number of pending requests (${this.maxPending}) reached.`);
    }

    const snapshotMappings: Record<string, string> = {};

    for (const [key, requestedPath] of Object.entries(fileMappings)) {
      snapshotMappings[key] = await createSnapshot(
        requestedPath,
        this.workspaceRoot,
        this.snapshotDir
      );
    }

    const request: PolicyRequest = {
      id: randomUUID(),
      commandName,
      args,
      fileMappings: snapshotMappings,
      state: 'Pending',
      createdAt: Date.now(),
    };

    await this.store.save(request);

    return request;
  }

  getInterpolatedArgs(request: PolicyRequest): string[] {
    return interpolateArgs(request.args, request.fileMappings);
  }
}
