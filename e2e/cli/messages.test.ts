import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import {
  TestEnvironment,
  type ChatSubscription,
  commandMatching,
  type SystemMessage,
  type ToolMessage,
} from '../_helpers/test-environment.js';

describe('E2E Messages Tests', () => {
  let env: TestEnvironment;
  let chat: ChatSubscription | undefined;

  beforeAll(async () => {
    env = new TestEnvironment('e2e-tmp-messages');
    await env.setup();
    await env.init();
    await env.up();
  }, 30000);

  afterAll(async () => {
    await env.teardown();
  }, 30000);

  afterEach(() => env.disconnectAll());

  it('should send a message via the daemon', async () => {
    chat = await env.connect('default');

    const { stdout, code } = await env.runCli(['messages', 'send', 'e2e test message']);

    expect(code).toBe(0);
    expect(stdout).toContain('Message sent successfully.');

    await chat.waitForMessage((m) => m.content === 'e2e test message');
  });

  it('should send a message to a specific chat', async () => {
    await env.addChat('specific-chat', 'default');
    chat = await env.connect('specific-chat');

    const { stdout, code } = await env.runCli([
      'messages',
      'send',
      'specific chat message',
      '--chat',
      'specific-chat',
    ]);

    expect(code).toBe(0);
    expect(stdout).toContain('Message sent successfully.');

    await chat.waitForMessage((m) => m.content === 'specific chat message');
  });

  it('should send a message with a specific agent and persist it', async () => {
    await env.runCli(['agents', 'add', 'custom-agent', '--env', 'CUSTOM_VAR=HELLO']);
    await env.addChat('agent-chat', 'default'); // default agent initially
    chat = await env.connect('agent-chat');

    const { stdout, code } = await env.runCli([
      'messages',
      'send',
      'hello custom agent',
      '--chat',
      'agent-chat',
      '--agent',
      'custom-agent',
    ]);

    expect(code).toBe(0);
    expect(stdout).toContain('Message sent successfully.');

    const chatSettings = env.getChatSettings('agent-chat');
    expect(chatSettings.defaultAgent).toBe('custom-agent');

    const { stderr: stderrFail, code: codeFail } = await env.runCli([
      'messages',
      'send',
      'fail msg',
      '--chat',
      'agent-chat',
      '--agent',
      'non-existent-agent',
    ]);

    expect(codeFail).toBe(1);
    expect(stderrFail).toContain("Error: Agent 'non-existent-agent' not found.");
  });

  it('should send a message with a file attachment', async () => {
    await env.addChat('file-chat', 'default');
    chat = await env.connect('file-chat');

    const testFilePath = path.resolve(env.e2eDir, 'test-attach.txt');
    fs.writeFileSync(testFilePath, 'file content');

    const { stdout, code } = await env.runCli([
      'messages',
      'send',
      'here is a file',
      '--chat',
      'file-chat',
      '--file',
      testFilePath,
    ]);

    expect(code).toBe(0);
    expect(stdout).toContain('Message sent successfully.');

    await chat.waitForMessage(
      (m) =>
        !!(m.content && m.content.includes('here is a file') && m.content.includes('test-attach'))
    );
  });

  it('should view history with tail and --json flag', async () => {
    await env.addChat('tail-chat', 'default');
    chat = await env.connect('tail-chat');

    const { code: sendCode } = await env.runCli([
      'messages',
      'send',
      'tail chat message',
      '--chat',
      'tail-chat',
    ]);
    expect(sendCode).toBe(0);

    await chat.waitForMessage((m) => m.content === 'tail chat message');

    const { stdout, code } = await env.runCli(['messages', 'tail', '--chat', 'tail-chat']);
    expect(code).toBe(0);
    expect(stdout).toContain('[USER]');
    expect(stdout).toContain('tail chat message');

    const { stdout: jsonStdout, code: jsonCode } = await env.runCli([
      'messages',
      'tail',
      '--json',
      '--chat',
      'tail-chat',
    ]);
    expect(jsonCode).toBe(0);
    expect(jsonStdout).toContain('"role":"user"');
    expect(jsonStdout).toContain('"content":"tail chat message"');
  });

  it('should maintain atomic ordering of user and log messages with --no-wait', async () => {
    await env.addAgent('order-agent');
    env.writeAgentSettings('order-agent', {
      commands: { new: 'sleep 1 && echo $CLAW_CLI_MESSAGE' },
    });

    await env.addChat('order-chat', 'order-agent');
    chat = await env.connect('order-chat');

    await env.runCli(['messages', 'send', 'first', '--chat', 'order-chat', '--no-wait']);
    await env.runCli(['messages', 'send', 'second', '--chat', 'order-chat', '--no-wait']);

    // We wait for the second command log to arrive.
    // The messages buffer will collect all messages as they arrive via SSE.
    await chat.waitForMessage(
      (m) => !!(m.role === 'command' && m.content && m.content.trim() === 'second')
    );

    // Retrieve the stored messages via trpcClient to ensure final ordering on disk
    const storedMessages = await env.trpcClient!.getMessages.query({ chatId: 'order-chat' });

    const commandLogs = storedMessages.filter((m) => m.role === 'command');
    expect(commandLogs).toHaveLength(2);
    expect(storedMessages[0]!.role).toBe('user');
    expect(storedMessages[0]!.content).toBe('first');
    expect(storedMessages[1]!.role).toBe('user');
    expect(storedMessages[1]!.content).toBe('second');
    expect(commandLogs[0]!.content.trim()).toBe('first');
    expect(commandLogs[1]!.content.trim()).toBe('second');
  }, 10000);

  it('should no-op (no command log, no agent reply) when the message is whitespace-only', async () => {
    await env.addAgent('empty-msg-agent');
    env.writeAgentSettings('empty-msg-agent', {
      commands: { new: 'echo should-not-run' },
    });
    await env.addChat('empty-msg-chat', 'empty-msg-agent');
    chat = await env.connect('empty-msg-chat');

    const { code } = await env.runCli([
      'messages',
      'send',
      '   ',
      '--chat',
      'empty-msg-chat',
    ]);
    expect(code).toBe(0);

    // The user message is still persisted before the short-circuit,
    await chat.waitForMessage((m) => m.role === 'user' && m.content.trim() === '');
    // but handleMessage bails before the agent runs: no command log, no reply.
    await new Promise((r) => setTimeout(r, 500));
    expect(chat.messageBuffer.some((m) => m.role === 'command' || m.role === 'agent')).toBe(
      false
    );
  });

  it('should handle full multi-message session workflow (extraction & append)', async () => {
    await env.addAgent('workflow-agent');
    env.writeAgentSettings('workflow-agent', {
      commands: {
        new: 'echo "NEW $CLAW_CLI_MESSAGE" && echo "ERR NEW" >&2',
        append: 'echo "APPEND $CLAW_CLI_MESSAGE" && echo "ERR APPEND" >&2',
        getSessionId: 'echo "session-123"',
        getMessageContent: 'sed "s/^/EXTRACTED-/"',
      },
    });

    await env.addChat('workflow-chat', 'workflow-agent');
    chat = await env.connect('workflow-chat');

    await env.runCli(['messages', 'send', 'msg-1', '--chat', 'workflow-chat']);

    const log1 = await chat.waitForMessage(
      commandMatching((m) => m.command.includes('ERR NEW'))
    );
    expect(log1.command).toBe('echo "NEW $CLAW_CLI_MESSAGE" && echo "ERR NEW" >&2');
    expect(log1.content).toContain('EXTRACTED-NEW msg-1');
    expect(log1.stderr).toContain('ERR NEW');
    expect(log1.stdout).toContain('NEW msg-1');

    const sessionSettings = env.getSessionSettings('workflow-agent', 'default');
    expect(
      (sessionSettings.env as Record<string, unknown> | undefined)?.SESSION_ID
    ).toBe('session-123');

    await env.runCli(['messages', 'send', 'msg-2', '--chat', 'workflow-chat']);

    const log2 = await chat.waitForMessage(
      commandMatching((m) => m.command.includes('ERR APPEND'))
    );
    expect(log2.command).toBe('echo "APPEND $CLAW_CLI_MESSAGE" && echo "ERR APPEND" >&2');
    expect(log2.content).toContain('EXTRACTED-APPEND msg-2');
    expect(log2.stderr).toContain('ERR APPEND');
    expect(log2.stdout).toContain('APPEND msg-2');

    // Break the extraction command and verify the failure is reported
    env.updateAgentSettings('workflow-agent', {
      commands: { getMessageContent: 'echo "EXTRACTION_FAIL" >&2 && exit 1' },
    });

    await env.runCli(['messages', 'send', 'msg-3', '--chat', 'workflow-chat']);

    const log3 = await chat.waitForMessage(
      commandMatching((m) => m.stderr.includes('EXTRACTION_FAIL'))
    );
    expect(log3.stdout).toContain('APPEND msg-3');
    expect(log3.stderr).toContain('ERR APPEND');
    expect(log3.stderr).toContain('getMessageContent failed: EXTRACTION_FAIL');
  }, 15000);

  it('should tail legacy chat entries that predate the sessionId field', async () => {
    await env.addChat('legacy-chat', 'default');

    const ts = new Date().toISOString();
    const legacyLines = [
      { id: 'u1', role: 'user', content: 'legacy user message', timestamp: ts },
      {
        id: 'c1',
        role: 'command',
        content: 'legacy cmd output',
        messageId: 'u1',
        command: 'echo legacy',
        cwd: '/tmp',
        stdout: 'legacy',
        stderr: '',
        exitCode: 0,
        timestamp: ts,
      },
      { id: 'a1', role: 'agent', content: 'legacy agent reply', timestamp: ts },
    ];
    const chatFile = env.getChatPath('legacy-chat', 'chat.jsonl');
    fs.writeFileSync(chatFile, legacyLines.map((l) => JSON.stringify(l)).join('\n') + '\n');

    const { stdout, code } = await env.runCli(['messages', 'tail', '--chat', 'legacy-chat']);
    expect(code).toBe(0);
    expect(stdout).toContain('legacy user message');
    expect(stdout).toContain('legacy agent reply');

    const { stdout: jsonStdout, code: jsonCode } = await env.runCli([
      'messages',
      'tail',
      '--json',
      '--chat',
      'legacy-chat',
    ]);
    expect(jsonCode).toBe(0);
    expect(jsonStdout).toContain('"content":"legacy user message"');
    expect(jsonStdout).toContain('"content":"legacy cmd output"');
    expect(jsonStdout).toContain('"content":"legacy agent reply"');
  });
});

describe('E2E Messages sessionId Persistence', () => {
  let env: TestEnvironment;
  let chat: ChatSubscription | undefined;

  beforeAll(async () => {
    env = new TestEnvironment('e2e-tmp-msg-sid');
    await env.setup();
    await env.setupSubagentEnv();
    await env.getAgentCredentials();
  }, 30000);

  afterAll(() => env.teardown(), 30000);
  afterEach(() => env.disconnectAll());

  it('stamps sessionId on user, command, agent, tool, and cron system messages', async () => {
    chat = await env.connect('__creds__');

    await env.sendMessage('echo hello-session', {
      chat: '__creds__',
      agent: 'debug-agent',
    });

    const userMsg = await chat.waitForMessage(
      (m) => m.role === 'user' && m.content === 'echo hello-session'
    );
    const cmdMsg = await chat.waitForMessage(
      commandMatching((m) => m.stdout.includes('echo hello-session'))
    );
    const replyMsg = await chat.waitForMessage((m) => m.role === 'agent');

    expect(userMsg.sessionId).toBeTruthy();
    expect(cmdMsg.sessionId).toBe(userMsg.sessionId);
    expect(replyMsg.sessionId).toBe(userMsg.sessionId);

    await env.runLite(['tool', 'session-tool', JSON.stringify({ probe: 1 })]);
    const toolMsg = await chat.waitForMessage(
      (m): m is ToolMessage => m.role === 'tool' && m.name === 'session-tool'
    );
    expect(toolMsg.sessionId).toBe(userMsg.sessionId);

    await env.runLite([
      'jobs', 'add', 'session-id-cron',
      '--at', '1s',
      '--message', 'echo session-cron-fired',
      '--session', 'new',
    ]);
    const sysMsg = await chat.waitForMessage(
      (m): m is SystemMessage =>
        m.role === 'system' && (m as SystemMessage).event === 'cron',
      10000
    );
    expect(sysMsg.sessionId).toBeTruthy();

    const cronCmd = await chat.waitForMessage(
      commandMatching((m) => m.stdout.includes('echo session-cron-fired')),
      10000
    );
    expect(cronCmd.sessionId).toBe(sysMsg.sessionId);
  }, 45000);
});
