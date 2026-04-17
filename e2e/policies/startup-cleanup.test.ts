import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { TestEnvironment } from '../_helpers/test-environment.js';
import type { PolicyRequest, RequestState } from '../../src/shared/policies.js';

describe('Policy Startup Cleanup E2E', () => {
  let env: TestEnvironment;
  let requestsDir: string;

  const makeRequest = (id: string, state: RequestState): PolicyRequest => ({
    id,
    commandName: 'test-cmd',
    args: [],
    fileMappings: {},
    state,
    createdAt: Date.now(),
    chatId: 'some-chat',
    agentId: 'some-agent',
  });

  const writeRequest = (req: PolicyRequest) => {
    fs.writeFileSync(path.join(requestsDir, `${req.id}.json`), JSON.stringify(req, null, 2));
  };

  beforeAll(async () => {
    env = new TestEnvironment('e2e-upgrade-cleanup');
    await env.setup();
    await env.init();

    requestsDir = path.resolve(env.e2eDir, '.clawmini/tmp/requests');
    fs.mkdirSync(requestsDir, { recursive: true });

    writeRequest(makeRequest('PENDING1', 'Pending'));
    writeRequest(makeRequest('APPROVED1', 'Approved'));
    writeRequest(makeRequest('REJECTED1', 'Rejected'));

    await env.up();
  }, 30000);

  afterAll(() => env.teardown(), 30000);

  it('deletes completed request files on startup and keeps pending ones', () => {
    expect(fs.existsSync(path.join(requestsDir, 'PENDING1.json'))).toBe(true);
    expect(fs.existsSync(path.join(requestsDir, 'APPROVED1.json'))).toBe(false);
    expect(fs.existsSync(path.join(requestsDir, 'REJECTED1.json'))).toBe(false);
  });
});
