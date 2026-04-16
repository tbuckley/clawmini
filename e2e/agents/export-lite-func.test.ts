import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import {
  TestEnvironment,
  type ChatSubscription,
  type ToolMessage,
  agentReplyWith,
} from '../_helpers/test-environment.js';

// Covers lite-only commands that aren't reachable via the main CLI: reply,
// reply --file, tool, and fetch-pending. Lite's jobs CRUD is covered by
// e2e/jobs/agent-jobs.test.ts and e2e/jobs/cron.test.ts.
//
// Every `it` here shares `__creds__` — the chat TestEnvironment.runLite uses
// when resolving its API token. A token is scoped to a single chatId, so all
// lite mutations in this file target `__creds__`.

describe('E2E Export Lite Chat/Tool Commands', () => {
  let env: TestEnvironment;
  let chat: ChatSubscription | undefined;

  beforeAll(async () => {
    env = new TestEnvironment('e2e-exp-lite');
    await env.setup();
    await env.setupSubagentEnv();
    // Warm up credentials (creates `__creds__` chat + sends one debug echo).
    await env.getAgentCredentials();
  }, 30000);

  afterAll(() => env.teardown(), 30000);
  afterEach(() => env.disconnectAll());

  it('reply appends an agent reply to the chat', async () => {
    chat = await env.connect('__creds__');
    const { stdout, code } = await env.runLite(['reply', 'hello reply']);
    expect(code).toBe(0);
    expect(stdout).toContain('Reply message appended');

    const msg = await chat.waitForMessage(agentReplyWith('hello reply'));
    expect(msg).toBeTruthy();
  }, 15000);

  it('reply --file records the attachment path relative to the workspace', async () => {
    chat = await env.connect('__creds__');
    const agentDir = path.resolve(env.e2eDir, 'debug-agent');
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, 'attach.txt'), 'attached');

    const { stdout, code } = await env.runLite(
      ['reply', 'hello with file', '--file', 'attach.txt'],
      { cwd: agentDir }
    );
    expect(code).toBe(0);
    expect(stdout).toContain('Reply message appended');

    const msg = await chat.waitForMessage(agentReplyWith('hello with file'));
    expect(msg.files).toEqual(['debug-agent/attach.txt']);
  }, 15000);

  it('tool appends a tool message preserving the JSON payload', async () => {
    chat = await env.connect('__creds__');
    const { stdout, code } = await env.runLite([
      'tool',
      'mytool',
      JSON.stringify({ key: 'value' }),
    ]);
    expect(code).toBe(0);
    expect(stdout).toContain('Tool message appended');

    const msg = await chat.waitForMessage(
      (m): m is ToolMessage => m.role === 'tool' && m.name === 'mytool'
    );
    expect(msg.payload).toEqual({ key: 'value' });
  }, 15000);

  it('fetch-pending returns queued messages while the agent is busy', async () => {
    chat = await env.connect('__creds__');
    // Swap debug-agent's commands to something slow so the first send blocks
    // the task queue and the second send stays pending until fetch-pending.
    // Both `new` and `append` must be overridden — getAgentCredentials has
    // already captured a SESSION_ID, so subsequent sends use `append`.
    const agentSettings = env.getAgentSettings('debug-agent');
    agentSettings.commands = {
      ...(agentSettings.commands ?? {}),
      new: 'sleep 5',
      append: 'sleep 5',
    };
    env.writeAgentSettings('debug-agent', agentSettings);

    await env.sendMessage('block queue', {
      chat: '__creds__',
      agent: 'debug-agent',
      noWait: true,
    });
    await env.sendMessage('my pending message', {
      chat: '__creds__',
      agent: 'debug-agent',
      noWait: true,
    });

    const { stdout, code } = await env.runLite(['fetch-pending']);
    expect(code).toBe(0);
    expect(stdout).toContain('<message>');
    expect(stdout).toContain('my pending message');
    expect(stdout).toContain('</message>');
  }, 20000);
});
