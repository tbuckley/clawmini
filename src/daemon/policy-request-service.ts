import { RequestStore, generateRandomAlphaNumericString } from './request-store.js';
import { createSnapshot, interpolateArgs } from './policy-utils.js';
import type { PolicyRequest } from '../shared/policies.js';

export class PolicyRequestService {
  private store: RequestStore;
  private maxPending: number;
  private agentDir: string;
  private snapshotDir: string;

  constructor(store: RequestStore, agentDir: string, snapshotDir: string, maxPending = 100) {
    this.store = store;
    this.agentDir = agentDir;
    this.snapshotDir = snapshotDir;
    this.maxPending = maxPending;
  }

  async createRequest(
    commandName: string,
    args: string[],
    fileMappings: Record<string, string>,
    chatId: string,
    agentId: string,
    skipSave: boolean = false
  ): Promise<PolicyRequest> {
    const allRequests = await this.store.list();
    const pendingCount = allRequests.filter((r) => r.state === 'Pending').length;

    if (pendingCount >= this.maxPending) {
      throw new Error(`Maximum number of pending requests (${this.maxPending}) reached.`);
    }

    const snapshotMappings: Record<string, string> = {};

    for (const [key, requestedPath] of Object.entries(fileMappings)) {
      snapshotMappings[key] = await createSnapshot(requestedPath, this.agentDir, this.snapshotDir);
    }

    let id = '';
    do {
      id = generateRandomAlphaNumericString(3);
    } while (allRequests.some((r) => r.id === id));

    const request: PolicyRequest = {
      id,
      commandName,
      args,
      fileMappings: snapshotMappings,
      state: skipSave ? 'Approved' : 'Pending',
      createdAt: Date.now(),
      chatId,
      agentId,
    };

    if (!skipSave) {
      await this.store.save(request);
    }

    return request;
  }

  getInterpolatedArgs(request: PolicyRequest): string[] {
    return interpolateArgs(request.args, request.fileMappings);
  }
}
