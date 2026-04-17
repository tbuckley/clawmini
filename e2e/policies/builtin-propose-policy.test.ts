import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import {
  TestEnvironment,
  type ChatSubscription,
  type SystemMessage,
  policyWith,
  commandMatching
} from '../_helpers/test-environment.js';

describe('Built-in propose-policy E2E', () => {
  let env: TestEnvironment;
  let chat: ChatSubscription | undefined;

  beforeAll(async () => {
    env = new TestEnvironment('e2e-builtin-propose-policy');
    await env.setup();
    await env.setupSubagentEnv({
      policies: {}
    });
  }, 30000);

  afterAll(() => env.teardown(), 30000);
  afterEach(() => env.disconnectAll());

  it('should allow the agent to use the built-in propose-policy policy', async () => {
    await env.addChat('chat-propose');
    chat = await env.connect('chat-propose');

    // The agent uses propose-policy to propose a new policy "npm-install"
    await env.sendMessage('clawmini-lite.js request propose-policy -- --name npm-install --description "Run npm install" --command "npm install"', {
      chat: 'chat-propose',
      agent: 'debug-agent',
    });

    const policy = await chat.waitForMessage(policyWith());
    const reqId = policy.requestId;

    // Approve the policy proposal
    await env.sendMessage(`/approve ${reqId}`, { chat: 'chat-propose' });

    // Wait for the agent to receive the approval notification
    const actorNotif = await chat.waitForMessage(
      (m): m is SystemMessage =>
        m.role === 'system' &&
        m.event === 'policy_approved' &&
        m.displayRole === 'user'
    );
    expect(actorNotif.content).toContain('Successfully proposed and registered policy \'npm-install\'');

    // Check that policies.json was updated and contains the new policy
    const policiesPath = path.resolve(env.e2eDir, '.clawmini/policies.json');
    const policies = JSON.parse(fs.readFileSync(policiesPath, 'utf8'));

    expect(policies.policies['npm-install']).toBeDefined();
    expect(policies.policies['npm-install'].command).toBe('npm');
    expect(policies.policies['npm-install'].args).toEqual(['install']);
  }, 30000);

  it('should disable propose-policy if set to false in policies.json', async () => {
    // Manually set propose-policy to false in policies.json
    const policiesPath = path.resolve(env.e2eDir, '.clawmini/policies.json');
    const policies = JSON.parse(fs.readFileSync(policiesPath, 'utf8'));
    policies.policies['propose-policy'] = false;
    fs.writeFileSync(policiesPath, JSON.stringify(policies, null, 2));

    await env.addChat('chat-disabled');
    chat = await env.connect('chat-disabled');

    // The agent tries to use the propose-policy
    await env.sendMessage('clawmini-lite.js request propose-policy -- --name foo --description "bar" --command "baz"', {
      chat: 'chat-disabled',
      agent: 'debug-agent',
    });

    // We should get a rejection or error from the router because the policy is not found
    const reply = await chat.waitForMessage(commandMatching((m) => m.stderr.includes('Policy not found: propose-policy')));

    expect(reply.stderr).toContain('Policy not found: propose-policy');
  }, 30000);
});
