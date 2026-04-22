import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fsPromises from 'node:fs/promises';
import {
  TestEnvironment,
  type ChatSubscription,
  policyWith,
  commandMatching,
} from '../_helpers/test-environment.js';

const DEFAULT_ENVIRONMENTS = { './debug-agent': 'testenv' } as const;

function setEnvironments(
  env: TestEnvironment,
  environments: Record<string, string> | undefined
): void {
  // updateSettings deep-merges, so we round-trip the whole settings object to
  // fully replace (or delete) the environments map.
  const settings = env.getSettings();
  if (environments === undefined) {
    delete settings.environments;
  } else {
    settings.environments = environments;
  }
  env.writeSettings(settings);
}

describe('Environment-scoped policies E2E', () => {
  let env: TestEnvironment;
  let chat: ChatSubscription | undefined;
  let envDir: string;

  beforeAll(async () => {
    env = new TestEnvironment('e2e-env-policies');
    await env.setup();
    await env.setupSubagentEnv({
      policies: {
        // Global policy that collides with an env policy of the same name. The
        // env version must win for agents running inside the env.
        conflicting: {
          description: 'Global version',
          command: 'echo',
          args: ['GLOBAL-VERSION'],
          autoApprove: true,
        },
      },
    });

    envDir = path.resolve(env.e2eDir, '.clawmini/environments/testenv');
    await fsPromises.mkdir(envDir, { recursive: true });

    // A helper script bundled with the env template. Relative command paths
    // in env.json should resolve against this directory.
    const scriptPath = path.join(envDir, 'env-script.mjs');
    await fsPromises.writeFile(
      scriptPath,
      '#!/usr/bin/env node\nconsole.log("ENV-SCRIPT-RAN");\n'
    );
    await fsPromises.chmod(scriptPath, 0o755);

    await fsPromises.writeFile(
      path.join(envDir, 'env.json'),
      JSON.stringify({
        policies: {
          'env-only': {
            description: 'Policy only available inside testenv',
            command: 'echo',
            args: ['ENV-ONLY-RAN'],
            autoApprove: true,
          },
          'env-script': {
            description: 'Uses a relative script path resolved to the env dir',
            command: './env-script.mjs',
            autoApprove: true,
          },
          conflicting: {
            description: 'Env version (overrides global of same name)',
            command: 'echo',
            args: ['ENV-VERSION'],
            autoApprove: true,
          },
        },
      })
    );
  }, 30000);

  afterAll(() => env.teardown(), 30000);

  // Scope the env to the debug-agent directory (the default layout for most
  // tests) before each test so tests that mutate environments don't leak.
  beforeEach(() => {
    setEnvironments(env, { ...DEFAULT_ENVIRONMENTS });
  });

  afterEach(() => env.disconnectAll());

  it('exposes env-scoped policies to agents running inside the env', async () => {
    await env.addChat('chat-inside');
    chat = await env.connect('chat-inside');

    await env.sendMessage('clawmini-lite.js request env-only', {
      chat: 'chat-inside',
      agent: 'debug-agent',
    });

    const policy = await chat.waitForMessage(policyWith('approved'));
    expect(policy.content).toContain('ENV-ONLY-RAN');
    expect(policy.content).toContain('Exit Code: 0');
  }, 30000);

  it('resolves relative command paths against the env directory', async () => {
    await env.addChat('chat-script');
    chat = await env.connect('chat-script');

    await env.sendMessage('clawmini-lite.js request env-script', {
      chat: 'chat-script',
      agent: 'debug-agent',
    });

    const policy = await chat.waitForMessage(policyWith('approved'));
    expect(policy.content).toContain('ENV-SCRIPT-RAN');
    // The command string must point at the env dir, proving the relative path
    // was resolved against it (not against the agent's cwd).
    expect(policy.content).toContain(path.join(envDir, 'env-script.mjs'));
  }, 30000);

  it('env policies override global policies of the same name', async () => {
    await env.addChat('chat-override');
    chat = await env.connect('chat-override');

    await env.sendMessage('clawmini-lite.js request conflicting', {
      chat: 'chat-override',
      agent: 'debug-agent',
    });

    const policy = await chat.waitForMessage(policyWith('approved'));
    expect(policy.content).toContain('ENV-VERSION');
    expect(policy.content).not.toContain('GLOBAL-VERSION');
  }, 30000);

  it('hides env-scoped policies from agents outside the env', async () => {
    // Re-scope the env to a sibling dir so the debug-agent is no longer inside
    // it. beforeEach restores the default mapping after this test.
    setEnvironments(env, { './other-dir': 'testenv' });

    await env.addChat('chat-outside');
    chat = await env.connect('chat-outside');

    await env.sendMessage('clawmini-lite.js request env-only', {
      chat: 'chat-outside',
      agent: 'debug-agent',
    });

    const reply = await chat.waitForMessage(
      commandMatching((m) => m.stderr.includes('Policy not found: env-only'))
    );
    expect(reply.stderr).toContain('Policy not found: env-only');
  }, 30000);

  it('falls back to the global policy when the env is not active', async () => {
    // Remove all env mappings — the env's `conflicting` should no longer apply,
    // leaving the global GLOBAL-VERSION definition as the only match.
    setEnvironments(env, undefined);

    await env.addChat('chat-fallback');
    chat = await env.connect('chat-fallback');

    await env.sendMessage('clawmini-lite.js request conflicting', {
      chat: 'chat-fallback',
      agent: 'debug-agent',
    });

    const policy = await chat.waitForMessage(policyWith('approved'));
    expect(policy.content).toContain('GLOBAL-VERSION');
    expect(policy.content).not.toContain('ENV-VERSION');
  }, 30000);
});
