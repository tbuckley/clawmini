import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createE2EContext, setupSubagentEnv, waitForMessage, waitForLogMatch } from './utils.js';

const { runCli, e2eDir, setupE2E, teardownE2E } = createE2EContext('e2e-policy-flows');

describe('Policy Flows E2E', () => {
  beforeAll(async () => {
    await setupE2E();
    await setupSubagentEnv(runCli, e2eDir, {
      port: 3016,
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

  const sanitizeContentForSnapshot = (content: string, reqId: string) => {
    return content.replace(new RegExp(reqId, 'g'), '<REQ_ID>');
  };

  it('should process /reject and route messages correctly for subagents', async () => {
    await runCli(['chats', 'add', 'chat-reject']);

    const customSubagentId = 'my-custom-subagent-reject';

    // Subagent spawns a request
    await runCli([
      'messages',
      'send',
      `clawmini-lite.js subagents spawn --id ${customSubagentId} --async "clawmini-lite.js request test-cmd --async"`,
      '--chat',
      'chat-reject',
      '--agent',
      'debug-agent',
    ]);

    const match = await waitForLogMatch(e2eDir, 'chat-reject', /"requestId":"([^"]+)"/);
    expect(match).not.toBeNull();
    const reqId = match![1] as string;

    // Call /pending just to maintain test flow
    await runCli(['messages', 'send', '/pending', '--chat', 'chat-reject']);

    // Reject the policy
    await runCli(['messages', 'send', `/reject ${reqId}`, '--chat', 'chat-reject']);

    // 1. Check user notification message
    const userNotificationMsg = await waitForMessage(
      e2eDir,
      'chat-reject',
      (m: Record<string, unknown>) =>
        m.role === 'system' &&
        m.event === 'policy_rejected' &&
        m.displayRole === 'agent' &&
        typeof m.content === 'string' &&
        m.content.includes(`Request ${reqId} (\`test-cmd\`) rejected`)
    );

    expect(userNotificationMsg).toBeDefined();
    expect(userNotificationMsg!.role).toBe('system');
    expect(userNotificationMsg!.event).toBe('policy_rejected');
    expect(userNotificationMsg!.displayRole).toBe('agent');
    expect(userNotificationMsg!.subagentId).toBeUndefined();
    expect(
      sanitizeContentForSnapshot(userNotificationMsg!.content as string, reqId)
    ).toMatchInlineSnapshot(
      `"Request <REQ_ID> (\`test-cmd\`) rejected. Reason: No reason provided"`
    );

    // 2. Check subagent notification message
    const subagentNotificationMsg = await waitForMessage(
      e2eDir,
      'chat-reject',
      (m: Record<string, unknown>) =>
        m.role === 'system' &&
        m.event === 'policy_rejected' &&
        m.displayRole === 'user' &&
        m.subagentId === customSubagentId
    );

    expect(subagentNotificationMsg).toBeDefined();
    expect(subagentNotificationMsg!.role).toBe('system');
    expect(subagentNotificationMsg!.event).toBe('policy_rejected');
    expect(subagentNotificationMsg!.displayRole).toBe('user');
    expect(subagentNotificationMsg!.subagentId).toBe(customSubagentId);
    expect(
      sanitizeContentForSnapshot(subagentNotificationMsg!.content as string, reqId)
    ).toMatchInlineSnapshot(`"Request <REQ_ID> rejected. Reason: No reason provided"`);
  }, 15000);

  it('should process /approve and route messages correctly for subagents', async () => {
    await runCli(['chats', 'add', 'chat-approve']);

    const customSubagentId = 'my-custom-subagent-approve';

    // Subagent spawns a request
    await runCli([
      'messages',
      'send',
      `clawmini-lite.js subagents spawn --id ${customSubagentId} --async "clawmini-lite.js request test-cmd"`,
      '--chat',
      'chat-approve',
      '--agent',
      'debug-agent',
    ]);

    const match = await waitForLogMatch(e2eDir, 'chat-approve', /"requestId":"([^"]+)"/);
    expect(match).not.toBeNull();
    const reqId = match![1] as string;

    // Call /pending just to maintain test flow
    await runCli(['messages', 'send', '/pending', '--chat', 'chat-approve']);

    // Approve the policy
    await runCli(['messages', 'send', `/approve ${reqId}`, '--chat', 'chat-approve']);

    // 1. Check user notification message
    const userNotificationMsg = await waitForMessage(
      e2eDir,
      'chat-approve',
      (m: Record<string, unknown>) =>
        m.role === 'system' &&
        m.event === 'policy_approved' &&
        m.displayRole === 'agent' &&
        typeof m.content === 'string' &&
        m.content.includes(`Request ${reqId} (\`test-cmd\`) approved`)
    );

    expect(userNotificationMsg).toBeDefined();
    expect(userNotificationMsg!.role).toBe('system');
    expect(userNotificationMsg!.event).toBe('policy_approved');
    expect(userNotificationMsg!.displayRole).toBe('agent');
    expect(userNotificationMsg!.subagentId).toBeUndefined();
    expect(
      sanitizeContentForSnapshot(userNotificationMsg!.content as string, reqId)
    ).toMatchInlineSnapshot(`"Request <REQ_ID> (\`test-cmd\`) approved."`);

    // 2. Check subagent notification message
    const subagentNotificationMsg = await waitForMessage(
      e2eDir,
      'chat-approve',
      (m: Record<string, unknown>) =>
        m.role === 'system' &&
        m.event === 'policy_approved' &&
        m.displayRole === 'user' &&
        m.subagentId === customSubagentId
    );

    expect(subagentNotificationMsg).toBeDefined();
    expect(subagentNotificationMsg!.role).toBe('system');
    expect(subagentNotificationMsg!.event).toBe('policy_approved');
    expect(subagentNotificationMsg!.displayRole).toBe('user');
    expect(subagentNotificationMsg!.subagentId).toBe(customSubagentId);
    expect(sanitizeContentForSnapshot(subagentNotificationMsg!.content as string, reqId))
      .toMatchInlineSnapshot(`
      "Request <REQ_ID> approved.

      <stdout>
      policy executed
      </stdout>

      <stderr></stderr>

      Exit Code: 0"
    `);
  }, 15000);
});
