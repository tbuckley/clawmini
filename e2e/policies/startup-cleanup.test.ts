import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { TestEnvironment } from '../_helpers/test-environment.js';

// Ticket 2 moved the policy store onto the unified `tmp/delegations/` tree.
// Per spec §5.6 "Lifecycle invariants", the daemon wipes the entire tree on
// startup — this regression check makes sure that wipe runs.
describe('Delegation Startup Wipe E2E', () => {
  let env: TestEnvironment;
  let delegationsDir: string;
  const chatId = 'some-chat';

  const writeDelegation = (id: string, state: 'pending' | 'completed' | 'rejected') => {
    const chatDir = path.join(delegationsDir, chatId);
    fs.mkdirSync(chatDir, { recursive: true });
    const record = {
      id,
      kind: 'policy' as const,
      state,
      delivery: 'notify' as const,
      chatId,
      agentId: 'some-agent',
      createdAt: new Date().toISOString(),
      commandName: 'test-cmd',
      args: [] as string[],
      fileMappings: {},
    };
    fs.writeFileSync(path.join(chatDir, `${id}.json`), JSON.stringify(record, null, 2));
  };

  beforeAll(async () => {
    env = new TestEnvironment('e2e-upgrade-cleanup');
    await env.setup();
    await env.init();

    delegationsDir = path.resolve(env.e2eDir, '.clawmini/tmp/delegations');

    // Seed a mix of states; all should be wiped on daemon start.
    writeDelegation('pen', 'pending');
    writeDelegation('com', 'completed');
    writeDelegation('rej', 'rejected');

    await env.up();
  }, 30000);

  afterAll(() => env.teardown(), 30000);

  it('wipes the entire delegations tree on daemon startup', () => {
    expect(fs.existsSync(path.join(delegationsDir, chatId, 'pen.json'))).toBe(false);
    expect(fs.existsSync(path.join(delegationsDir, chatId, 'com.json'))).toBe(false);
    expect(fs.existsSync(path.join(delegationsDir, chatId, 'rej.json'))).toBe(false);
  });
});
