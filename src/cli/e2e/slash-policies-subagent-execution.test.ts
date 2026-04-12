import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createE2EContext, setupSubagentEnv, waitForMessage, waitForLogMatch } from './utils.js';

const { runCli, e2eDir, setupE2E, teardownE2E } = createE2EContext('e2e-policy-subagent-exec');

describe('Subagent Policy Execution Routing E2E', () => {
  beforeAll(async () => {
    await setupE2E();
    await setupSubagentEnv(runCli, e2eDir, {
      port: 3015,
      policies: {
        'test-cmd': {
          description: 'A test policy',
          command: 'echo',
          args: ['policy executed'],
        },
      },
    });
  }, 30000);

  afterAll(teardownE2E, 30000);

  it('should correctly route policy execution result to the subagent instead of the parent agent', async () => {
    await runCli(['chats', 'add', 'chat-exec']);

    // Let the subagent spawn a request
    await runCli([
      'messages',
      'send',
      'clawmini-lite.js subagents spawn --async "clawmini-lite.js request test-cmd"',
      '--chat',
      'chat-exec',
      '--agent',
      'debug-agent',
    ]);

    // Wait for the request to be created by the subagent
    const match = await waitForLogMatch(e2eDir, 'chat-exec', /"requestId":"([^"]+)"/);
    expect(match).not.toBeNull();
    const reqId = match![1];

    // Call /pending just to maintain test flow
    await runCli(['messages', 'send', '/pending', '--chat', 'chat-exec']);

    // Approve the policy
    await runCli(['messages', 'send', `/approve ${reqId}`, '--chat', 'chat-exec']);

    // Wait for approval processing
    const reactionMsg = await waitForMessage(
      e2eDir,
      'chat-exec',
      (m: Record<string, unknown>) =>
        m.role === 'agent' &&
        typeof m.content === 'string' &&
        m.content.includes(`Request ${reqId} approved`)
    );

    expect(reactionMsg).toBeDefined();

    // The key validation: the reaction must belong to the subagent, NOT the parent agent!
    expect(reactionMsg!.subagentId).toBeDefined();
    expect(reactionMsg!.subagentId.length).toBeGreaterThan(0);
  }, 15000);
});
