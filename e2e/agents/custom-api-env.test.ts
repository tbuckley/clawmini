import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { TestEnvironment, type ChatSubscription } from '../_helpers/test-environment.js';
import type { CommandLogMessage, AgentReplyMessage } from '../../src/daemon/chats.js';

describe('E2E Agent Custom API Env Var Names', () => {
  let env: TestEnvironment;
  let chat: ChatSubscription | undefined;

  beforeAll(async () => {
    env = new TestEnvironment('e2e-custom-api-env');
    await env.setup();
    // setupSubagentEnv boots the daemon on a free port and exports lite.
    await env.setupSubagentEnv();
  }, 30000);

  afterAll(() => env.teardown(), 30000);
  afterEach(async () => {
    await chat?.disconnect();
    chat = undefined;
  });

  it('injects custom-named URL/token envs and lite consumes them via pointer vars', async () => {
    await env.runCli(['agents', 'add', 'custom-env-dumper']);
    const agentDir = path.resolve(env.e2eDir, 'custom-env-dumper');
    fs.mkdirSync(agentDir, { recursive: true });

    env.writeAgentSettings('custom-env-dumper', {
      apiTokenEnvVar: 'MY_CUSTOM_TOKEN',
      apiUrlEnvVar: 'MY_CUSTOM_URL',
      commands: { new: 'env' },
    });

    await env.addChat('custom-env-chat', 'custom-env-dumper');
    chat = await env.connect('custom-env-chat');

    await env.sendMessage('dump', { chat: 'custom-env-chat', agent: 'custom-env-dumper' });

    const log = await chat.waitForMessage(
      (m): m is CommandLogMessage =>
        m.role === 'command' && typeof m.stdout === 'string' && m.stdout.includes('MY_CUSTOM_URL=')
    );

    expect(log.stdout).toContain('CLAW_LITE_API_VAR=MY_CUSTOM_TOKEN');
    expect(log.stdout).toContain('CLAW_LITE_URL_VAR=MY_CUSTOM_URL');
    expect(log.stdout).toMatch(/^MY_CUSTOM_URL=http:\/\/127\.0\.0\.1:\d+$/m);
    expect(log.stdout).toMatch(/^MY_CUSTOM_TOKEN=.+$/m);
    // The default-named vars should NOT be present when custom names are set.
    expect(log.stdout).not.toMatch(/^CLAW_API_URL=/m);
    expect(log.stdout).not.toMatch(/^CLAW_API_TOKEN=/m);

    const urlMatch = log.stdout.match(/^MY_CUSTOM_URL=(.+)$/m);
    const tokenMatch = log.stdout.match(/^MY_CUSTOM_TOKEN=(.+)$/m);
    const customUrl = urlMatch![1]!.trim();
    const customToken = tokenMatch![1]!.trim();

    // Spawn lite directly (TestEnvironment.runLite forces CLAW_API_URL/TOKEN, which
    // wouldn't exercise the dynamic-name path).
    const litePath = path.resolve(env.e2eDir, 'clawmini-lite.js');
    const reply = await new Promise<{ stdout: string; code: number | null }>((resolve) => {
      const p = spawn('node', [litePath, 'reply', 'hello from custom env'], {
        env: {
          ...process.env,
          MY_CUSTOM_URL: customUrl,
          MY_CUSTOM_TOKEN: customToken,
          CLAW_LITE_URL_VAR: 'MY_CUSTOM_URL',
          CLAW_LITE_API_VAR: 'MY_CUSTOM_TOKEN',
        },
        cwd: agentDir,
      });
      let stdout = '';
      p.stdout.on('data', (d) => (stdout += d.toString()));
      p.stderr.on('data', (d) => (stdout += d.toString()));
      p.on('close', (code) => resolve({ stdout, code }));
    });
    expect(reply.stdout).toContain('Reply message appended');

    const replyMsg = await chat.waitForMessage(
      (m): m is AgentReplyMessage => m.role === 'agent' && m.content === 'hello from custom env'
    );
    expect(replyMsg).toBeTruthy();
  }, 20000);
});
