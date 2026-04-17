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

const PROPOSE_SCRIPT_REL = '.clawmini/policy-scripts/propose-policy.js';

describe('Built-in propose-policy installation', () => {
  let env: TestEnvironment;

  beforeAll(async () => {
    env = new TestEnvironment('e2e-builtin-install');
    await env.setup();
  }, 30000);

  afterAll(() => env.teardown(), 30000);

  it('init writes the propose-policy script to disk', async () => {
    const { code, stderr } = await env.init();
    if (code !== 0) throw new Error(`Init failed: ${stderr}`);

    const scriptPath = path.resolve(env.e2eDir, PROPOSE_SCRIPT_REL);
    expect(fs.existsSync(scriptPath)).toBe(true);
    const content = fs.readFileSync(scriptPath, 'utf8');
    expect(content.startsWith('#!')).toBe(true);
    expect((fs.statSync(scriptPath).mode & 0o111) !== 0).toBe(true);
  }, 30000);

  it('up refreshes a stale propose-policy script', async () => {
    const scriptPath = path.resolve(env.e2eDir, PROPOSE_SCRIPT_REL);
    const original = fs.readFileSync(scriptPath, 'utf8');

    fs.writeFileSync(scriptPath, '#!/usr/bin/env node\n// stale\n');
    expect(fs.readFileSync(scriptPath, 'utf8')).not.toBe(original);

    const { code, stderr } = await env.up();
    if (code !== 0) throw new Error(`Up failed: ${stderr}`);

    expect(fs.readFileSync(scriptPath, 'utf8')).toBe(original);
  }, 30000);
});

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

    // Disabling the policy must not delete the installed script — the user can
    // re-enable it later just by removing the `false` entry.
    const scriptPath = path.resolve(env.e2eDir, PROPOSE_SCRIPT_REL);
    expect(fs.existsSync(scriptPath)).toBe(true);
  }, 30000);
});

describe('Built-in propose-policy override', () => {
  let env: TestEnvironment;

  beforeAll(async () => {
    env = new TestEnvironment('e2e-builtin-override');
    await env.setup();
    await env.setupSubagentEnv({
      policies: {
        'propose-policy': {
          description: 'user-defined override',
          command: 'echo',
          args: ['overridden'],
          allowHelp: true,
        },
      },
    });
  }, 30000);

  afterAll(() => env.teardown(), 30000);

  it('runs a user-defined propose-policy override instead of the built-in', async () => {
    await env.addChat('chat-override');
    const chat = await env.connect('chat-override');
    try {
      await env.sendMessage(
        'clawmini-lite.js request propose-policy -- --name custom --description "x" --command "echo y"',
        { chat: 'chat-override', agent: 'debug-agent' }
      );

      const policy = await chat.waitForMessage(policyWith());
      const reqId = policy.requestId;

      await env.sendMessage(`/approve ${reqId}`, { chat: 'chat-override' });

      const actorNotif = await chat.waitForMessage(
        (m): m is SystemMessage =>
          m.role === 'system' && m.event === 'policy_approved' && m.displayRole === 'user'
      );
      // The override sends `echo overridden ...args` so stdout starts with "overridden".
      expect(actorNotif.content).toContain('overridden');
      // Built-in success message must NOT appear — the override took effect.
      expect(actorNotif.content).not.toContain('Successfully proposed and registered policy');

      // policies.json should be unchanged: the override is `echo`, which never
      // writes to it, so no `custom` entry should have been added.
      const policiesPath = path.resolve(env.e2eDir, '.clawmini/policies.json');
      const policies = JSON.parse(fs.readFileSync(policiesPath, 'utf8'));
      expect(policies.policies['custom']).toBeUndefined();
      // And the user override must still be intact.
      expect(policies.policies['propose-policy']).toMatchObject({
        command: 'echo',
        args: ['overridden'],
      });
    } finally {
      await chat.disconnect();
    }
  }, 30000);
});
