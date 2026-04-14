import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { TestEnvironment, type ChatSubscription } from '../_helpers/test-environment.js';
import type { AgentReplyMessage, PolicyRequestMessage } from '../../src/daemon/chats.js';

describe('Output Size E2E', () => {
  let env: TestEnvironment;
  let chat: ChatSubscription | undefined;

  beforeAll(async () => {
    env = new TestEnvironment('e2e-output-size');
    await env.setup();
    await env.setupSubagentEnv({
      policies: {
        'short-cmd': {
          description: 'A short output policy',
          command: 'node',
          args: ['-e', 'console.log("short output")'],
          autoApprove: true,
        },
        'long-cmd': {
          description: 'A long output policy',
          command: 'node',
          args: ['-e', 'console.log("a".repeat(600))'],
          autoApprove: true,
        },
        'long-err': {
          description: 'A long stderr policy',
          command: 'node',
          args: ['-e', 'console.error("e".repeat(600))'],
          autoApprove: true,
        },
      },
    });
  }, 30000);

  afterAll(() => env.teardown(), 30000);
  afterEach(async () => {
    await chat?.disconnect();
    chat = undefined;
  });

  it('should return inline output for < 500 characters', async () => {
    await env.runCli(['chats', 'add', 'chat-short']);
    chat = await env.connect('chat-short');

    await env.sendMessage('clawmini-lite.js request short-cmd', {
      chat: 'chat-short',
      agent: 'debug-agent',
    });

    const reply = await chat.waitForMessage((m): m is AgentReplyMessage => m.role === 'agent');
    expect(reply.content).toContain('[DEBUG] clawmini-lite.js request short-cmd');
    expect(reply.content).toContain('short output');
  }, 30000);

  it('should intercept large stdout and return a summary string', async () => {
    await env.runCli(['chats', 'add', 'chat-long-out']);
    chat = await env.connect('chat-long-out');

    await env.sendMessage('clawmini-lite.js request long-cmd', {
      chat: 'chat-long-out',
      agent: 'debug-agent',
    });

    const policy = await chat.waitForMessage(
      (m): m is PolicyRequestMessage => m.role === 'policy' && m.status === 'approved'
    );
    expect(policy.content).toMatch(
      /stdout is 60\d characters, saved to \.\/tmp\/stdout-[a-zA-Z0-9-]+\.txt/
    );

    // Read the file via the debug-agent
    await env.sendMessage(`cat ./tmp/stdout-${policy.requestId}.txt`, {
      chat: 'chat-long-out',
      agent: 'debug-agent',
    });

    const reply = await chat.waitForMessage(
      (m): m is AgentReplyMessage =>
        m.role === 'agent' &&
        typeof m.content === 'string' &&
        m.content.includes('cat ./tmp/stdout-')
    );
    expect(reply.content).toContain('a'.repeat(600));
  }, 30000);

  it('should intercept large stderr and return a summary string', async () => {
    await env.runCli(['chats', 'add', 'chat-long-err']);
    chat = await env.connect('chat-long-err');

    await env.sendMessage('clawmini-lite.js request long-err', {
      chat: 'chat-long-err',
      agent: 'debug-agent',
    });

    const policy = await chat.waitForMessage(
      (m): m is PolicyRequestMessage => m.role === 'policy' && m.status === 'approved'
    );
    expect(policy.content).toMatch(
      /stderr is 60\d characters, saved to \.\/tmp\/stderr-[a-zA-Z0-9-]+\.txt/
    );
  }, 30000);
});
