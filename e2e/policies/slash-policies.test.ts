import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  createE2EContext,
  setupSubagentEnv,
  waitForMessage,
  waitForLogMatch,
} from '../_helpers/utils.js';

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

  it('should process /reject and route messages correctly for main agents', async () => {
    await runCli(['chats', 'add', 'chat-reject-main']);

    // Main agent spawns a request
    await runCli([
      'messages',
      'send',
      `clawmini-lite.js request test-cmd --async`,
      '--chat',
      'chat-reject-main',
      '--agent',
      'debug-agent',
    ]);

    const match = await waitForLogMatch(e2eDir, 'chat-reject-main', /"requestId":"([^"]+)"/);
    expect(match).not.toBeNull();
    const reqId = match![1] as string;

    // Call /pending just to maintain test flow
    await runCli(['messages', 'send', '/pending', '--chat', 'chat-reject-main']);

    // Reject the policy
    await runCli(['messages', 'send', `/reject ${reqId}`, '--chat', 'chat-reject-main']);

    // 1. Check user notification message
    const userNotificationMsg = await waitForMessage(
      e2eDir,
      'chat-reject-main',
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

    // 2. Check main agent notification message
    const agentNotificationMsg = await waitForMessage(
      e2eDir,
      'chat-reject-main',
      (m: Record<string, unknown>) =>
        m.role === 'system' &&
        m.event === 'policy_rejected' &&
        m.displayRole === 'user' &&
        m.subagentId === undefined
    );

    expect(agentNotificationMsg).toBeDefined();
    expect(agentNotificationMsg!.role).toBe('system');
    expect(agentNotificationMsg!.event).toBe('policy_rejected');
    expect(agentNotificationMsg!.displayRole).toBe('user');
    expect(agentNotificationMsg!.subagentId).toBeUndefined();
    expect(
      sanitizeContentForSnapshot(agentNotificationMsg!.content as string, reqId)
    ).toMatchInlineSnapshot(`"Request <REQ_ID> rejected. Reason: No reason provided"`);
  }, 15000);

  it('should process /approve and route messages correctly for main agents', async () => {
    await runCli(['chats', 'add', 'chat-approve-main']);

    // Main agent spawns a request
    await runCli([
      'messages',
      'send',
      `clawmini-lite.js request test-cmd`,
      '--chat',
      'chat-approve-main',
      '--agent',
      'debug-agent',
    ]);

    const match = await waitForLogMatch(e2eDir, 'chat-approve-main', /"requestId":"([^"]+)"/);
    expect(match).not.toBeNull();
    const reqId = match![1] as string;

    // Call /pending just to maintain test flow
    await runCli(['messages', 'send', '/pending', '--chat', 'chat-approve-main']);

    // Approve the policy
    await runCli(['messages', 'send', `/approve ${reqId}`, '--chat', 'chat-approve-main']);

    // 1. Check user notification message
    const userNotificationMsg = await waitForMessage(
      e2eDir,
      'chat-approve-main',
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

    // 2. Check main agent notification message
    const agentNotificationMsg = await waitForMessage(
      e2eDir,
      'chat-approve-main',
      (m: Record<string, unknown>) =>
        m.role === 'system' &&
        m.event === 'policy_approved' &&
        m.displayRole === 'user' &&
        m.subagentId === undefined
    );

    expect(agentNotificationMsg).toBeDefined();
    expect(agentNotificationMsg!.role).toBe('system');
    expect(agentNotificationMsg!.event).toBe('policy_approved');
    expect(agentNotificationMsg!.displayRole).toBe('user');
    expect(agentNotificationMsg!.subagentId).toBeUndefined();
    expect(sanitizeContentForSnapshot(agentNotificationMsg!.content as string, reqId))
      .toMatchInlineSnapshot(`
      "Request <REQ_ID> approved.

      <stdout>
      policy executed
      </stdout>

      <stderr></stderr>

      Exit Code: 0"
    `);
  }, 15000);

  it('should list pending requests in /pending output', async () => {
    await runCli(['chats', 'add', 'chat-pending-list']);

    await runCli([
      'messages',
      'send',
      `clawmini-lite.js request test-cmd`,
      '--chat',
      'chat-pending-list',
      '--agent',
      'debug-agent',
    ]);

    const match = await waitForLogMatch(e2eDir, 'chat-pending-list', /"requestId":"([^"]+)"/);
    expect(match).not.toBeNull();
    const reqId = match![1] as string;

    await runCli(['messages', 'send', '/pending', '--chat', 'chat-pending-list']);

    const reply = await waitForMessage(
      e2eDir,
      'chat-pending-list',
      (m: Record<string, unknown>) =>
        m.role === 'system' &&
        m.event === 'router' &&
        typeof m.content === 'string' &&
        m.content.includes('Pending Requests')
    );

    expect(reply).not.toBeNull();
    expect(reply!.content).toContain('Pending Requests (1):');
    expect(reply!.content).toContain(`- ID: ${reqId} | Command: test-cmd`);
  }, 15000);

  it('should persist a custom reason when /reject is given one', async () => {
    await runCli(['chats', 'add', 'chat-reject-reason']);

    await runCli([
      'messages',
      'send',
      `clawmini-lite.js request test-cmd`,
      '--chat',
      'chat-reject-reason',
      '--agent',
      'debug-agent',
    ]);

    const match = await waitForLogMatch(e2eDir, 'chat-reject-reason', /"requestId":"([^"]+)"/);
    expect(match).not.toBeNull();
    const reqId = match![1] as string;

    await runCli([
      'messages',
      'send',
      `/reject ${reqId} command looked suspicious`,
      '--chat',
      'chat-reject-reason',
    ]);

    const userMsg = await waitForMessage(
      e2eDir,
      'chat-reject-reason',
      (m: Record<string, unknown>) =>
        m.role === 'system' && m.event === 'policy_rejected' && m.displayRole === 'agent'
    );
    expect(userMsg!.content).toContain('command looked suspicious');

    const agentMsg = await waitForMessage(
      e2eDir,
      'chat-reject-reason',
      (m: Record<string, unknown>) =>
        m.role === 'system' && m.event === 'policy_rejected' && m.displayRole === 'user'
    );
    expect(agentMsg!.content).toContain('command looked suspicious');

    const reqPath = path.resolve(e2eDir, `.clawmini/tmp/requests/${reqId}.json`);
    const stored = JSON.parse(fs.readFileSync(reqPath, 'utf8'));
    expect(stored.rejectionReason).toBe('command looked suspicious');
  }, 15000);

  describe('validation branches', () => {
    it('should reply "Request not found" for /approve with an unknown id', async () => {
      await runCli(['chats', 'add', 'chat-notfound']);

      await runCli(['messages', 'send', '/approve nonexistent-id', '--chat', 'chat-notfound']);

      const reply = await waitForMessage(
        e2eDir,
        'chat-notfound',
        (m: Record<string, unknown>) =>
          m.role === 'system' &&
          m.event === 'router' &&
          typeof m.content === 'string' &&
          m.content.includes('Request not found: nonexistent-id')
      );
      expect(reply).not.toBeNull();
    }, 15000);

    it('should refuse cross-chat /approve', async () => {
      await runCli(['chats', 'add', 'chat-owner']);
      await runCli(['chats', 'add', 'chat-intruder']);

      await runCli([
        'messages',
        'send',
        `clawmini-lite.js request test-cmd`,
        '--chat',
        'chat-owner',
        '--agent',
        'debug-agent',
      ]);

      const match = await waitForLogMatch(e2eDir, 'chat-owner', /"requestId":"([^"]+)"/);
      expect(match).not.toBeNull();
      const reqId = match![1] as string;

      await runCli(['messages', 'send', `/approve ${reqId}`, '--chat', 'chat-intruder']);

      const reply = await waitForMessage(
        e2eDir,
        'chat-intruder',
        (m: Record<string, unknown>) =>
          m.role === 'system' &&
          m.event === 'router' &&
          typeof m.content === 'string' &&
          m.content.includes('Request belongs to a different chat')
      );
      expect(reply).not.toBeNull();
    }, 15000);

    it('should refuse /approve on an already-approved request', async () => {
      await runCli(['chats', 'add', 'chat-double-approve']);

      await runCli([
        'messages',
        'send',
        `clawmini-lite.js request test-cmd`,
        '--chat',
        'chat-double-approve',
        '--agent',
        'debug-agent',
      ]);

      const match = await waitForLogMatch(
        e2eDir,
        'chat-double-approve',
        /"requestId":"([^"]+)"/
      );
      expect(match).not.toBeNull();
      const reqId = match![1] as string;

      await runCli(['messages', 'send', `/approve ${reqId}`, '--chat', 'chat-double-approve']);

      // Wait for the first approval to complete before sending a second one.
      await waitForMessage(
        e2eDir,
        'chat-double-approve',
        (m: Record<string, unknown>) =>
          m.role === 'system' && m.event === 'policy_approved'
      );

      await runCli(['messages', 'send', `/approve ${reqId}`, '--chat', 'chat-double-approve']);

      const reply = await waitForMessage(
        e2eDir,
        'chat-double-approve',
        (m: Record<string, unknown>) =>
          m.role === 'system' &&
          m.event === 'router' &&
          typeof m.content === 'string' &&
          m.content.includes('Request is not pending')
      );
      expect(reply).not.toBeNull();
    }, 15000);

    it('should reply "Policy not found" if the policy was removed after request creation', async () => {
      const policiesPath = path.resolve(e2eDir, '.clawmini/policies.json');
      const original = JSON.parse(fs.readFileSync(policiesPath, 'utf8'));
      const mutated = JSON.parse(JSON.stringify(original));
      mutated.policies['temp-cmd'] = {
        description: 'Temporary',
        command: 'echo',
        args: ['temp'],
      };
      fs.writeFileSync(policiesPath, JSON.stringify(mutated));

      try {
        await runCli(['chats', 'add', 'chat-policy-gone']);

        await runCli([
          'messages',
          'send',
          `clawmini-lite.js request temp-cmd`,
          '--chat',
          'chat-policy-gone',
          '--agent',
          'debug-agent',
        ]);

        const match = await waitForLogMatch(
          e2eDir,
          'chat-policy-gone',
          /"requestId":"([^"]+)"/
        );
        expect(match).not.toBeNull();
        const reqId = match![1] as string;

        // Remove the policy before /approve is processed
        fs.writeFileSync(policiesPath, JSON.stringify(original));

        await runCli(['messages', 'send', `/approve ${reqId}`, '--chat', 'chat-policy-gone']);

        const reply = await waitForMessage(
          e2eDir,
          'chat-policy-gone',
          (m: Record<string, unknown>) =>
            m.role === 'system' &&
            m.event === 'router' &&
            typeof m.content === 'string' &&
            m.content.includes('Policy not found: temp-cmd')
        );
        expect(reply).not.toBeNull();
      } finally {
        fs.writeFileSync(policiesPath, JSON.stringify(original));
      }
    }, 15000);
  });
});
