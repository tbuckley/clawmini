import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  TestEnvironment,
  type ChatSubscription,
  type SystemMessage,
  policyWith,
} from '../_helpers/test-environment.js';

describe('Policy Flows E2E', () => {
  let env: TestEnvironment;
  let chat: ChatSubscription | undefined;
  let secondChat: ChatSubscription | undefined;

  beforeAll(async () => {
    env = new TestEnvironment('e2e-policy-flows');
    await env.setup();
    await env.setupSubagentEnv({
      policies: {
        'test-cmd': {
          description: 'A test policy',
          command: 'echo',
          args: ['policy executed'],
        },
      },
    });
  }, 30000);

  afterAll(() => env.teardown(), 30000);
  afterEach(() => env.disconnectAll());

  const sanitize = (content: string, reqId: string) =>
    content.replace(new RegExp(reqId, 'g'), '<REQ_ID>');

  const approvedStdout =
    'Request <REQ_ID> approved.\n\n<stdout>\npolicy executed\n</stdout>\n\n<stderr></stderr>\n\nExit Code: 0';

  type RouteCase = {
    label: string;
    chat: string;
    spawn: string;
    action: 'approve' | 'reject';
    event: 'policy_approved' | 'policy_rejected';
    subagentId: string | undefined;
    expectedUserContent: string;
    expectedActorContent: string;
  };

  const routeCases: RouteCase[] = [
    {
      label: 'subagent /reject',
      chat: 'chat-reject-sub',
      spawn:
        'clawmini-lite.js subagents spawn --id sub-reject --async "clawmini-lite.js request test-cmd --async"',
      action: 'reject',
      event: 'policy_rejected',
      subagentId: 'sub-reject',
      expectedUserContent: 'Request <REQ_ID> (`test-cmd`) rejected. Reason: No reason provided',
      expectedActorContent: 'Request <REQ_ID> rejected. Reason: No reason provided',
    },
    {
      label: 'subagent /approve',
      chat: 'chat-approve-sub',
      spawn:
        'clawmini-lite.js subagents spawn --id sub-approve --async "clawmini-lite.js request test-cmd"',
      action: 'approve',
      event: 'policy_approved',
      subagentId: 'sub-approve',
      expectedUserContent: 'Request <REQ_ID> (`test-cmd`) approved.',
      expectedActorContent: approvedStdout,
    },
    {
      label: 'main agent /reject',
      chat: 'chat-reject-main',
      spawn: 'clawmini-lite.js request test-cmd --async',
      action: 'reject',
      event: 'policy_rejected',
      subagentId: undefined,
      expectedUserContent: 'Request <REQ_ID> (`test-cmd`) rejected. Reason: No reason provided',
      expectedActorContent: 'Request <REQ_ID> rejected. Reason: No reason provided',
    },
    {
      label: 'main agent /approve',
      chat: 'chat-approve-main',
      spawn: 'clawmini-lite.js request test-cmd',
      action: 'approve',
      event: 'policy_approved',
      subagentId: undefined,
      expectedUserContent: 'Request <REQ_ID> (`test-cmd`) approved.',
      expectedActorContent: approvedStdout,
    },
  ];

  it.each(routeCases)(
    'routes policy notifications ($label)',
    async ({ chat: chatId, spawn, action, event, subagentId, expectedUserContent, expectedActorContent }) => {
      await env.addChat(chatId);
      chat = await env.connect(chatId);

      await env.sendMessage(spawn, { chat: chatId, agent: 'debug-agent' });

      const policy = await chat.waitForMessage(
        policyWith()
      );
      const reqId = policy.requestId;

      await env.sendMessage(`/${action} ${reqId}`, { chat: chatId });

      const userNotif = await chat.waitForMessage(
        (m): m is SystemMessage =>
          m.role === 'system' && m.event === event && m.displayRole === 'agent'
      );
      expect(userNotif.subagentId).toBeUndefined();
      expect(sanitize(userNotif.content, reqId)).toBe(expectedUserContent);

      const actorNotif = await chat.waitForMessage(
        (m): m is SystemMessage =>
          m.role === 'system' &&
          m.event === event &&
          m.displayRole === 'user' &&
          m.subagentId === subagentId
      );
      expect(sanitize(actorNotif.content, reqId)).toBe(expectedActorContent);
    },
    15000
  );

  it('should list pending requests in /pending output', async () => {
    await env.addChat('chat-pending-list');
    chat = await env.connect('chat-pending-list');

    await env.sendMessage('clawmini-lite.js request test-cmd', {
      chat: 'chat-pending-list',
      agent: 'debug-agent',
    });

    const reqId = (
      await chat.waitForMessage(policyWith())
    ).requestId;

    await env.sendMessage('/pending', { chat: 'chat-pending-list' });

    const reply = await chat.waitForMessage(
      (m): m is SystemMessage =>
        m.role === 'system' &&
        m.event === 'router' &&
        typeof m.content === 'string' &&
        m.content.includes('Pending Requests')
    );

    expect(reply.content).toContain('Pending Requests (1):');
    expect(reply.content).toContain(`- ID: ${reqId} | Command: test-cmd`);
  }, 15000);

  it('should persist a custom reason when /reject is given one', async () => {
    await env.addChat('chat-reject-reason');
    chat = await env.connect('chat-reject-reason');

    await env.sendMessage('clawmini-lite.js request test-cmd', {
      chat: 'chat-reject-reason',
      agent: 'debug-agent',
    });

    const reqId = (
      await chat.waitForMessage(policyWith())
    ).requestId;

    await env.sendMessage(`/reject ${reqId} command looked suspicious`, {
      chat: 'chat-reject-reason',
    });

    const userMsg = await chat.waitForMessage(
      (m): m is SystemMessage =>
        m.role === 'system' && m.event === 'policy_rejected' && m.displayRole === 'agent'
    );
    expect(userMsg.content).toContain('command looked suspicious');

    const agentMsg = await chat.waitForMessage(
      (m): m is SystemMessage =>
        m.role === 'system' && m.event === 'policy_rejected' && m.displayRole === 'user'
    );
    expect(agentMsg.content).toContain('command looked suspicious');

    const reqPath = path.resolve(env.e2eDir, `.clawmini/tmp/requests/${reqId}.json`);
    const stored = JSON.parse(fs.readFileSync(reqPath, 'utf8'));
    expect(stored.rejectionReason).toBe('command looked suspicious');
  }, 15000);

  describe('validation branches', () => {
    it('should reply "Request not found" for /approve with an unknown id', async () => {
      await env.addChat('chat-notfound');
      chat = await env.connect('chat-notfound');

      await env.sendMessage('/approve nonexistent-id', { chat: 'chat-notfound' });

      await chat.waitForMessage(
        (m): m is SystemMessage =>
          m.role === 'system' &&
          m.event === 'router' &&
          typeof m.content === 'string' &&
          m.content.includes('Request not found: nonexistent-id')
      );
    }, 15000);

    it('should refuse cross-chat /approve', async () => {
      await env.addChat('chat-owner');
      await env.addChat('chat-intruder');
      chat = await env.connect('chat-owner');

      await env.sendMessage('clawmini-lite.js request test-cmd', {
        chat: 'chat-owner',
        agent: 'debug-agent',
      });

      const reqId = (
        await chat.waitForMessage(policyWith())
      ).requestId;

      secondChat = await env.connect('chat-intruder');

      await env.sendMessage(`/approve ${reqId}`, { chat: 'chat-intruder' });

      await secondChat.waitForMessage(
        (m): m is SystemMessage =>
          m.role === 'system' &&
          m.event === 'router' &&
          typeof m.content === 'string' &&
          m.content.includes('Request belongs to a different chat')
      );
    }, 15000);

    it('should refuse /approve on an already-approved request', async () => {
      await env.addChat('chat-double-approve');
      chat = await env.connect('chat-double-approve');

      await env.sendMessage('clawmini-lite.js request test-cmd', {
        chat: 'chat-double-approve',
        agent: 'debug-agent',
      });

      const reqId = (
        await chat.waitForMessage(policyWith())
      ).requestId;

      await env.sendMessage(`/approve ${reqId}`, { chat: 'chat-double-approve' });

      // Wait for the first approval to complete before sending a second one.
      await chat.waitForMessage(
        (m): m is SystemMessage => m.role === 'system' && m.event === 'policy_approved'
      );

      await env.sendMessage(`/approve ${reqId}`, { chat: 'chat-double-approve' });

      await chat.waitForMessage(
        (m): m is SystemMessage =>
          m.role === 'system' &&
          m.event === 'router' &&
          typeof m.content === 'string' &&
          m.content.includes('Request is not pending')
      );
    }, 15000);

    it('should reply "Policy not found" if the policy was removed after request creation', async () => {
      const policiesPath = path.resolve(env.e2eDir, '.clawmini/policies.json');
      const original = JSON.parse(fs.readFileSync(policiesPath, 'utf8'));
      const mutated = JSON.parse(JSON.stringify(original));
      mutated.policies['temp-cmd'] = {
        description: 'Temporary',
        command: 'echo',
        args: ['temp'],
      };
      fs.writeFileSync(policiesPath, JSON.stringify(mutated));

      try {
        await env.addChat('chat-policy-gone');
        chat = await env.connect('chat-policy-gone');

        await env.sendMessage('clawmini-lite.js request temp-cmd', {
          chat: 'chat-policy-gone',
          agent: 'debug-agent',
        });

        const reqId = (
          await chat.waitForMessage(policyWith())
        ).requestId;

        // Remove the policy before /approve is processed
        fs.writeFileSync(policiesPath, JSON.stringify(original));

        await env.sendMessage(`/approve ${reqId}`, { chat: 'chat-policy-gone' });

        await chat.waitForMessage(
          (m): m is SystemMessage =>
            m.role === 'system' &&
            m.event === 'router' &&
            typeof m.content === 'string' &&
            m.content.includes('Policy not found: temp-cmd')
        );
      } finally {
        fs.writeFileSync(policiesPath, JSON.stringify(original));
      }
    }, 15000);
  });
});
