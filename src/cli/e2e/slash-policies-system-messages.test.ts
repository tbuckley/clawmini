import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createE2EContext, setupSubagentEnv, waitForMessage, waitForLogMatch } from './utils.js';

const { runCli, e2eDir, setupE2E, teardownE2E } = createE2EContext('e2e-policy-system-msgs');

describe('Policy Confirmation System Messages E2E', () => {
  beforeAll(async () => {
    await setupE2E();
    await setupSubagentEnv(runCli, e2eDir, {
      port: 3014,
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

  it('should append a system message to the main chat upon /reject of a policy from a subagent', async () => {
    await runCli(['chats', 'add', 'chat-reject']);

    // Let the subagent spawn a request
    await runCli([
      'messages',
      'send',
      'clawmini-lite.js request test-cmd --async',
      '--chat',
      'chat-reject',
      '--agent',
      'debug-agent',
    ]);

    // Wait for the request to be created by the subagent
    const match = await waitForLogMatch(e2eDir, 'chat-reject', /"requestId":"([^"]+)"/);
    expect(match).not.toBeNull();
    const reqId = match![1];

    // Call /pending just to maintain test flow
    const { stdout } = await runCli(['messages', 'send', '/pending', '--chat', 'chat-reject']);
    console.log('/pending output:', stdout);

    // Reject the policy
    await runCli(['messages', 'send', `/reject ${reqId}`, '--chat', 'chat-reject']);

    // Wait for reject processing
    const rejectSysMsg = await waitForMessage(
      e2eDir,
      'chat-reject',
      (m: any) =>
        m.role === 'system' &&
        m.event === 'policy_rejected' &&
        m.displayRole === 'agent' &&
        m.content.includes(`Request ${reqId} rejected`)
    );

    expect(rejectSysMsg).toBeDefined();
    expect(rejectSysMsg!.subagentId).toBeUndefined();
  }, 15000);

  it('should append a system message to the main chat upon /approve of a policy from a subagent', async () => {
    await runCli(['chats', 'add', 'chat-approve']);

    // Let the subagent spawn a request
    await runCli([
      'messages',
      'send',
      'clawmini-lite.js request test-cmd --async',
      '--chat',
      'chat-approve',
      '--agent',
      'debug-agent',
    ]);

    // Wait for the request to be created by the subagent
    const match = await waitForLogMatch(e2eDir, 'chat-approve', /"requestId":"([^"]+)"/);
    expect(match).not.toBeNull();
    const reqId = match![1];

    // Approve the policy
    await runCli(['messages', 'send', `/approve ${reqId}`, '--chat', 'chat-approve']);

    // Wait for approve processing
    const approveSysMsg = await waitForMessage(
      e2eDir,
      'chat-approve',
      (m: Record<string, unknown>) =>
        m.role === 'system' &&
        m.event === 'policy_approved' &&
        m.displayRole === 'agent' &&
        typeof m.content === 'string' &&
        m.content.includes(`Request ${reqId} approved.`)
    );

    expect(approveSysMsg).toBeDefined();
    expect(approveSysMsg!.subagentId).toBeUndefined();
  }, 15000);
});
