import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  TestEnvironment,
  type ChatSubscription,
  type SystemMessage,
  policyWith,
} from '../_helpers/test-environment.js';

// Ticket 2: policy RPCs now route through `DelegationManager`, which writes
// records under `.clawmini/tmp/delegations/<chatId>/<id>.json` and retains
// them across resolution. Until Ticket 6 adds `delegations show`, we assert
// directly on the on-disk record.
describe('Policy delegations via DelegationManager (e2e)', () => {
  let env: TestEnvironment;
  let chat: ChatSubscription | undefined;

  beforeAll(async () => {
    env = new TestEnvironment('e2e-delegation-policy');
    await env.setup();
    await env.setupSubagentEnv({
      policies: {
        'echo-cmd': {
          description: 'A manual-approval policy',
          command: 'echo',
          args: ['policy-output'],
        },
        'auto-cmd': {
          description: 'An auto-approve policy',
          command: 'echo',
          args: ['auto-output'],
          autoApprove: true,
        },
      },
    });
  }, 30000);

  afterAll(() => env.teardown(), 30000);
  afterEach(() => env.disconnectAll());

  const readDelegation = (chatId: string, id: string) => {
    const recPath = path.resolve(
      env.e2eDir,
      `.clawmini/tmp/delegations/${chatId}/${id}.json`
    );
    if (!fs.existsSync(recPath)) return null;
    return JSON.parse(fs.readFileSync(recPath, 'utf8'));
  };

  it('after /approve the resolved record is retained with state=completed and executionResult', async () => {
    const chatId = 'chat-approve-retains';
    await env.addChat(chatId);
    chat = await env.connect(chatId);

    await env.sendMessage('clawmini-lite.js request echo-cmd', {
      chat: chatId,
      agent: 'debug-agent',
    });

    const policy = await chat.waitForMessage(policyWith());
    const reqId = policy.requestId;

    // Sanity: pending record is on disk before approval.
    const pendingRec = readDelegation(chatId, reqId);
    expect(pendingRec).not.toBeNull();
    expect(pendingRec.kind).toBe('policy');
    expect(pendingRec.state).toBe('pending');

    await env.sendMessage(`/approve ${reqId}`, { chat: chatId });

    // Wait for the approval feedback so we know the manager has finished
    // writing the resolved record.
    await chat.waitForMessage(
      (m): m is SystemMessage =>
        m.role === 'system' && m.event === 'policy_approved' && m.displayRole === 'user'
    );

    const resolvedRec = readDelegation(chatId, reqId);
    expect(resolvedRec).not.toBeNull();
    expect(resolvedRec.kind).toBe('policy');
    expect(resolvedRec.state).toBe('completed');
    expect(typeof resolvedRec.resolvedAt).toBe('string');
    expect(resolvedRec.executionResult).toBeDefined();
    expect(resolvedRec.executionResult.exitCode).toBe(0);
    expect(resolvedRec.executionResult.stdout).toContain('policy-output');
  }, 30000);

  it('auto-approved policies write state=completed straight to disk without entering pending', async () => {
    // Use a dedicated creds-bound chat so the on-disk path is predictable.
    const chatId = 'chat-auto-approve-direct';
    const creds = await env.getAgentCredentialsForChat(chatId);
    const agentDir = path.resolve(env.e2eDir, 'debug-agent');

    const { stdout, stderr, code } = await env.runLite(['request', 'auto-cmd'], {
      creds,
      cwd: agentDir,
    });
    expect(stderr).toBe('');
    expect(code).toBe(0);
    expect(stdout).toContain('auto-output');

    const delegationsChatDir = path.join(
      env.e2eDir,
      '.clawmini',
      'tmp',
      'delegations',
      chatId
    );
    const files = fs
      .readdirSync(delegationsChatDir)
      .filter((f) => f.endsWith('.json'));
    expect(files.length).toBe(1);
    const rec = JSON.parse(fs.readFileSync(path.join(delegationsChatDir, files[0]!), 'utf8'));
    expect(rec.kind).toBe('policy');
    expect(rec.state).toBe('completed');
    expect(rec.executionResult).toBeDefined();
    expect(rec.executionResult.exitCode).toBe(0);
    expect(rec.executionResult.stdout).toContain('auto-output');
    expect(typeof rec.resolvedAt).toBe('string');
  }, 30000);

  it('after /reject the record is retained with state=rejected and rejectionReason', async () => {
    const chatId = 'chat-reject-retains';
    await env.addChat(chatId);
    chat = await env.connect(chatId);

    await env.sendMessage('clawmini-lite.js request echo-cmd', {
      chat: chatId,
      agent: 'debug-agent',
    });

    const policy = await chat.waitForMessage(policyWith());
    const reqId = policy.requestId;

    await env.sendMessage(`/reject ${reqId} suspicious activity`, { chat: chatId });

    await chat.waitForMessage(
      (m): m is SystemMessage =>
        m.role === 'system' && m.event === 'policy_rejected' && m.displayRole === 'user'
    );

    const rec = readDelegation(chatId, reqId);
    expect(rec).not.toBeNull();
    expect(rec.kind).toBe('policy');
    expect(rec.state).toBe('rejected');
    expect(rec.rejectionReason).toBe('suspicious activity');
    expect(typeof rec.resolvedAt).toBe('string');
    expect(rec.executionResult).toBeUndefined();
  }, 30000);
});
