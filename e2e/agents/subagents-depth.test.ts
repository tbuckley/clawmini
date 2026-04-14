import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { TestEnvironment, type ChatSubscription } from '../_helpers/test-environment.js';

// The subagent happy-path (depth 1 lite spawn produces a debug echo in the
// parent chat) is already covered by session-timeout-subagents.test.ts, so
// this file only exercises the MAX_SUBAGENT_DEPTH guard.

describe('E2E Subagents Depth Limit', () => {
  let env: TestEnvironment;
  let chat: ChatSubscription | undefined;

  beforeAll(async () => {
    env = new TestEnvironment('e2e-subagents-depth');
    await env.setup();
    await env.setupSubagentEnv();
  }, 30000);

  afterAll(() => env.teardown(), 30000);
  afterEach(async () => {
    await chat?.disconnect();
    chat = undefined;
  });

  it('rejects subagent spawns beyond MAX_SUBAGENT_DEPTH (currently 2)', async () => {
    await env.addChat('chat-limit', 'debug-agent');
    chat = await env.connect('chat-limit');

    // Three nested spawns: the innermost "echo hi" would run at depth 3,
    // which exceeds the server-side limit.
    await env.sendMessage(
      'clawmini-lite.js subagents spawn --async "clawmini-lite.js subagents spawn --async \\"clawmini-lite.js subagents spawn --async \\\\\\"echo hi\\\\\\"\\""',
      { chat: 'chat-limit', agent: 'debug-agent' }
    );

    await chat.waitForMessage(
      (m) => JSON.stringify(m).includes('Max subagent depth reached'),
      15000
    );

    // The innermost echo must never have run — the guard fires before
    // the debug template gets a chance to eval it.
    expect(
      chat.messageBuffer.some(
        (m) =>
          typeof (m as { stdout?: string }).stdout === 'string' &&
          (m as { stdout?: string }).stdout!.includes('[DEBUG] hi:')
      )
    ).toBe(false);
  }, 20000);
});
