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

const SCRIPT_REL = '.clawmini/policy-scripts/manage-policies.js';

describe('Built-in manage-policies installation', () => {
  let env: TestEnvironment;

  beforeAll(async () => {
    env = new TestEnvironment('e2e-builtin-install');
    await env.setup();
  }, 30000);

  afterAll(() => env.teardown(), 30000);

  it('init writes the manage-policies script to disk', async () => {
    const { code, stderr } = await env.init();
    if (code !== 0) throw new Error(`Init failed: ${stderr}`);

    const scriptPath = path.resolve(env.e2eDir, SCRIPT_REL);
    expect(fs.existsSync(scriptPath)).toBe(true);
    const content = fs.readFileSync(scriptPath, 'utf8');
    expect(content.startsWith('#!')).toBe(true);
    expect((fs.statSync(scriptPath).mode & 0o111) !== 0).toBe(true);
  }, 30000);

  it('up refreshes a stale manage-policies script', async () => {
    const scriptPath = path.resolve(env.e2eDir, SCRIPT_REL);
    const original = fs.readFileSync(scriptPath, 'utf8');

    fs.writeFileSync(scriptPath, '#!/usr/bin/env node\n// stale\n');
    expect(fs.readFileSync(scriptPath, 'utf8')).not.toBe(original);

    const { code, stderr } = await env.up();
    if (code !== 0) throw new Error(`Up failed: ${stderr}`);

    expect(fs.readFileSync(scriptPath, 'utf8')).toBe(original);
  }, 30000);
});

describe('Built-in manage-policies E2E', () => {
  let env: TestEnvironment;
  let chat: ChatSubscription | undefined;

  beforeAll(async () => {
    env = new TestEnvironment('e2e-builtin-manage-policies');
    await env.setup();
    await env.setupSubagentEnv({
      policies: {}
    });
  }, 30000);

  afterAll(() => env.teardown(), 30000);
  afterEach(() => env.disconnectAll());

  it('should allow the agent to add a new policy via manage-policies add', async () => {
    await env.addChat('chat-add');
    chat = await env.connect('chat-add');

    await env.sendMessage(
      'clawmini-lite.js request manage-policies -- add --name npm-install --description "Run npm install" --command "npm install"',
      {
        chat: 'chat-add',
        agent: 'debug-agent',
      }
    );

    const policy = await chat.waitForMessage(policyWith());
    const reqId = policy.requestId;

    await env.sendMessage(`/approve ${reqId}`, { chat: 'chat-add' });

    const actorNotif = await chat.waitForMessage(
      (m): m is SystemMessage =>
        m.role === 'system' &&
        m.event === 'policy_approved' &&
        m.displayRole === 'user'
    );
    expect(actorNotif.content).toContain("Successfully added policy 'npm-install'");

    const policiesPath = path.resolve(env.e2eDir, '.clawmini/policies.json');
    const policies = JSON.parse(fs.readFileSync(policiesPath, 'utf8'));

    expect(policies.policies['npm-install']).toBeDefined();
    expect(policies.policies['npm-install'].command).toBe('npm');
    expect(policies.policies['npm-install'].args).toEqual(['install']);
  }, 30000);

  it('should disable manage-policies if set to false in policies.json', async () => {
    const policiesPath = path.resolve(env.e2eDir, '.clawmini/policies.json');
    const policies = JSON.parse(fs.readFileSync(policiesPath, 'utf8'));
    policies.policies['manage-policies'] = false;
    fs.writeFileSync(policiesPath, JSON.stringify(policies, null, 2));

    await env.addChat('chat-disabled');
    chat = await env.connect('chat-disabled');

    await env.sendMessage(
      'clawmini-lite.js request manage-policies -- add --name foo --description "bar" --command "baz"',
      {
        chat: 'chat-disabled',
        agent: 'debug-agent',
      }
    );

    const reply = await chat.waitForMessage(
      commandMatching((m) => m.stderr.includes('Policy not found: manage-policies'))
    );

    expect(reply.stderr).toContain('Policy not found: manage-policies');

    // Disabling the policy must not delete the installed script — the user can
    // re-enable it later just by removing the `false` entry.
    const scriptPath = path.resolve(env.e2eDir, SCRIPT_REL);
    expect(fs.existsSync(scriptPath)).toBe(true);
  }, 30000);
});

describe('Built-in manage-policies override', () => {
  let env: TestEnvironment;

  beforeAll(async () => {
    env = new TestEnvironment('e2e-builtin-override');
    await env.setup();
    await env.setupSubagentEnv({
      policies: {
        'manage-policies': {
          description: 'user-defined override',
          command: 'echo',
          args: ['overridden'],
          allowHelp: true,
        },
      },
    });
  }, 30000);

  afterAll(() => env.teardown(), 30000);

  it('runs a user-defined manage-policies override instead of the built-in', async () => {
    await env.addChat('chat-override');
    const chat = await env.connect('chat-override');
    try {
      await env.sendMessage(
        'clawmini-lite.js request manage-policies -- add --name custom --description "x" --command "echo y"',
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
      expect(actorNotif.content).not.toContain('Successfully added policy');

      // policies.json should be unchanged: the override is `echo`, which never
      // writes to it, so no `custom` entry should have been added.
      const policiesPath = path.resolve(env.e2eDir, '.clawmini/policies.json');
      const policies = JSON.parse(fs.readFileSync(policiesPath, 'utf8'));
      expect(policies.policies['custom']).toBeUndefined();
      // And the user override must still be intact.
      expect(policies.policies['manage-policies']).toMatchObject({
        command: 'echo',
        args: ['overridden'],
      });
    } finally {
      await chat.disconnect();
    }
  }, 30000);
});
