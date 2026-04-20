import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import {
  TestEnvironment,
  type ChatSubscription,
  type SystemMessage,
  policyWith,
} from '../_helpers/test-environment.js';

const RUN_HOST_SCRIPT_REL = '.clawmini/policy-scripts/run-host.js';

describe('Built-in run-host installation', () => {
  let env: TestEnvironment;

  beforeAll(async () => {
    env = new TestEnvironment('e2e-builtin-run-host-install');
    await env.setup();
  }, 30000);

  afterAll(() => env.teardown(), 30000);

  it('init writes the run-host script to disk', async () => {
    const { code, stderr } = await env.init();
    if (code !== 0) throw new Error(`Init failed: ${stderr}`);

    const scriptPath = path.resolve(env.e2eDir, RUN_HOST_SCRIPT_REL);
    expect(fs.existsSync(scriptPath)).toBe(true);
    const content = fs.readFileSync(scriptPath, 'utf8');
    expect(content.startsWith('#!')).toBe(true);
    expect((fs.statSync(scriptPath).mode & 0o111) !== 0).toBe(true);
  }, 30000);
});

describe('Built-in run-host E2E', () => {
  let env: TestEnvironment;
  let chat: ChatSubscription | undefined;

  beforeAll(async () => {
    env = new TestEnvironment('e2e-builtin-run-host');
    await env.setup();
    await env.setupSubagentEnv({
      policies: {},
    });
  }, 30000);

  afterAll(() => env.teardown(), 30000);
  afterEach(() => env.disconnectAll());

  it('executes a shell command with pipes and && via run-host after approval', async () => {
    await env.addChat('chat-run');
    chat = await env.connect('chat-run');

    await env.sendMessage(
      'clawmini-lite.js request run-host -- --command "echo hello && echo world | tr a-z A-Z"',
      { chat: 'chat-run', agent: 'debug-agent' }
    );

    const policy = await chat.waitForMessage(policyWith());
    const reqId = policy.requestId;

    await env.sendMessage(`/approve ${reqId}`, { chat: 'chat-run' });

    const actorNotif = await chat.waitForMessage(
      (m): m is SystemMessage =>
        m.role === 'system' &&
        m.event === 'policy_approved' &&
        m.displayRole === 'user'
    );

    expect(actorNotif.content).toContain('hello');
    expect(actorNotif.content).toContain('WORLD');
    expect(actorNotif.content).toContain('Exit Code: 0');
  }, 30000);

  it('propagates non-zero exit codes from the executed command', async () => {
    await env.addChat('chat-exit');
    chat = await env.connect('chat-exit');

    await env.sendMessage(
      'clawmini-lite.js request run-host -- --command "false"',
      { chat: 'chat-exit', agent: 'debug-agent' }
    );

    const policy = await chat.waitForMessage(policyWith());
    const reqId = policy.requestId;

    await env.sendMessage(`/approve ${reqId}`, { chat: 'chat-exit' });

    const actorNotif = await chat.waitForMessage(
      (m): m is SystemMessage =>
        m.role === 'system' &&
        m.event === 'policy_approved' &&
        m.displayRole === 'user'
    );

    expect(actorNotif.content).toContain('Exit Code: 1');
  }, 30000);

  it('does not auto-approve — request stays pending until the user approves', async () => {
    await env.addChat('chat-pending');
    chat = await env.connect('chat-pending');

    await env.sendMessage(
      'clawmini-lite.js request run-host -- --command "echo should-not-run-yet"',
      { chat: 'chat-pending', agent: 'debug-agent' }
    );

    const policy = await chat.waitForMessage(policyWith());
    expect(policy.status).toBe('pending');

    const approvedEarly = chat.messageBuffer.find(
      (m): m is SystemMessage =>
        m.role === 'system' && m.event === 'policy_approved'
    );
    expect(approvedEarly).toBeUndefined();
  }, 30000);

  it('supports --help via lite', async () => {
    const { stdout, code } = await env.runLite(['request', 'run-host', '--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('--command');
  }, 30000);
});
