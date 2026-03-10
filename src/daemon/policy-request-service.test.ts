import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { RequestStore } from './request-store.js';
import { PolicyRequestService } from './policy-request-service.js';

describe('PolicyRequestService', () => {
  let tmpDir: string;
  let agentDir: string;
  let snapshotDir: string;
  let store: RequestStore;
  let service: PolicyRequestService;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'policy-request-service-test-'));
    agentDir = path.join(tmpDir, 'agent');
    snapshotDir = path.join(tmpDir, 'snapshots');

    await fs.mkdir(agentDir, { recursive: true });

    store = new RequestStore(tmpDir);
    service = new PolicyRequestService(store, agentDir, snapshotDir, 2);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('should create a request, snapshotting files and storing it', async () => {
    const testFile = path.join(agentDir, 'test.txt');
    await fs.writeFile(testFile, 'hello world');

    const request = await service.createRequest(
      'testCmd',
      ['--file', '{{myFile}}'],
      {
        myFile: 'test.txt',
      },
      'chat-123',
      'agent-abc'
    );

    expect(request.id).toBeDefined();
    expect(request.commandName).toBe('testCmd');
    expect(request.state).toBe('Pending');
    expect(Object.keys(request.fileMappings)).toHaveLength(1);

    const snapshotPath = request.fileMappings['myFile'];
    expect(snapshotPath).toBeDefined();
    expect(snapshotPath!.startsWith(snapshotDir)).toBe(true);

    const snapshotContent = await fs.readFile(snapshotPath!, 'utf8');
    expect(snapshotContent).toBe('hello world');

    const storedRequests = await store.list();
    expect(storedRequests).toHaveLength(1);
    expect(storedRequests[0]?.id).toBe(request.id);
  });

  it('should reject when pending limit is reached', async () => {
    await service.createRequest('cmd1', [], {}, 'chat-1', 'agent-1');
    await service.createRequest('cmd2', [], {}, 'chat-2', 'agent-2');

    await expect(service.createRequest('cmd3', [], {}, 'chat-3', 'agent-3')).rejects.toThrow(
      'Maximum number of pending requests (2) reached.'
    );
  });

  it('should correctly interpolate arguments', async () => {
    const testFile = path.join(agentDir, 'test.txt');
    await fs.writeFile(testFile, 'hello world');

    const request = await service.createRequest(
      'testCmd',
      ['--input', '{{inputFile}}'],
      {
        inputFile: 'test.txt',
      },
      'chat-4',
      'agent-4'
    );

    const interpolatedArgs = service.getInterpolatedArgs(request);
    expect(interpolatedArgs).toEqual(['--input', request.fileMappings['inputFile']]);
  });
});
