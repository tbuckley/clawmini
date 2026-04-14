import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createE2EContext, setupSubagentEnv, waitForMessage } from '../_helpers/utils.js';
import path from 'node:path';
import fs from 'node:fs/promises';

const { runCli, e2eDir, setupE2E, teardownE2E } = createE2EContext('e2e-context-cwd');

describe('Context-Aware Execution E2E', () => {
  beforeAll(async () => {
    await setupE2E();
    await setupSubagentEnv(runCli, e2eDir, {
      port: 3018,
      policies: {
        'print-cwd': {
          description: 'Print the current working directory',
          command: 'pwd',
          args: [],
          autoApprove: true,
        },
      },
    });

    // Create a subdirectory 'foo' in the debug-agent's directory
    const agentDir = path.join(e2eDir, 'debug-agent');
    await fs.mkdir(path.join(agentDir, 'foo'), { recursive: true });
  }, 30000);

  afterAll(teardownE2E, 30000);

  it('should execute policy in the requested subdirectory', async () => {
    await runCli(['chats', 'add', 'chat-cwd']);

    // Send a message that simulates the agent navigating to 'foo' and calling the policy.
    await runCli([
      'messages',
      'send',
      `cd foo && clawmini-lite.js request print-cwd`,
      '--chat',
      'chat-cwd',
      '--agent',
      'debug-agent',
    ]);

    const replyMsg = await waitForMessage(
      e2eDir,
      'chat-cwd',
      (m: Record<string, unknown>) => m.role === 'policy' && m.status === 'approved'
    );

    expect(replyMsg).not.toBeNull();
    // The policy's output should contain 'foo' as the current working directory
    expect(replyMsg!.content).toContain('foo');

    // Check that it's actually within the debug-agent's foo folder
    expect(replyMsg!.content).toContain(path.join('debug-agent', 'foo'));
  }, 30000);
});
