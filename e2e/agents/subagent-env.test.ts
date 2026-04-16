import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { TestEnvironment, type ChatSubscription, commandMatching } from '../_helpers/test-environment.js';

describe('E2E Agent subagentEnv Merge', () => {
  let env: TestEnvironment;
  let chat: ChatSubscription | undefined;

  beforeAll(async () => {
    env = new TestEnvironment('e2e-subagent-env');
    await env.setup();
    await env.setupSubagentEnv();

    const agentSettings = env.getAgentSettings('debug-agent');
    agentSettings.env = {
      ...((agentSettings.env as Record<string, string>) ?? {}),
      PARENT_VAR: 'parent',
    };
    agentSettings.subagentEnv = {
      SUBAGENT_VAR: 'sub',
      PARENT_VAR: 'overridden',
    };
    env.writeAgentSettings('debug-agent', agentSettings);
  }, 30000);

  afterAll(() => env.teardown(), 30000);
  afterEach(() => env.disconnectAll());

  it('applies subagentEnv only to subagent invocations, not the parent', async () => {
    await env.addChat('subenv-chat', 'debug-agent');
    chat = await env.connect('subenv-chat');

    // 1) Parent: plain env dump should include PARENT_VAR and omit SUBAGENT_VAR.
    await env.sendMessage('env', { chat: 'subenv-chat', agent: 'debug-agent' });
    const parentLog = await chat.waitForMessage(
      commandMatching(
        (m) => !m.subagentId && m.stdout.includes('[DEBUG] env:') && m.stdout.includes('PARENT_VAR=')
      )
    );
    expect(parentLog.stdout).toMatch(/^PARENT_VAR=parent$/m);
    expect(parentLog.stdout).not.toMatch(/^SUBAGENT_VAR=/m);

    // 2) Subagent: spawn one that runs env; its log should show overridden
    //    PARENT_VAR and the subagent-only SUBAGENT_VAR.
    await env.sendMessage('clawmini-lite.js subagents spawn --async "env"', {
      chat: 'subenv-chat',
      agent: 'debug-agent',
    });

    const subLog = await chat.waitForMessage(
      commandMatching((m) => typeof m.subagentId === 'string' && m.stdout.includes('SUBAGENT_VAR='))
    );
    expect(subLog.stdout).toMatch(/^SUBAGENT_VAR=sub$/m);
    expect(subLog.stdout).toMatch(/^PARENT_VAR=overridden$/m);
  }, 20000);
});
