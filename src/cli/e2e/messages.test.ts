import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { TestEnvironment } from './test-environment.js';
import type { CommandLogMessage } from '../../daemon/chats.js';

describe('E2E Messages Tests', () => {
  let env: TestEnvironment;

  beforeAll(async () => {
    env = new TestEnvironment('e2e-tmp-messages');
    await env.setup();
    await env.init();
    await env.up();
  }, 30000);

  afterAll(async () => {
    await env.teardown();
  }, 30000);

  it('should send a message via the daemon', async () => {
    await env.connect('default');

    const { stdout, code } = await env.runCli(['messages', 'send', 'e2e test message']);

    expect(code).toBe(0);
    expect(stdout).toContain('Message sent successfully.');

    const msg = await env.waitForMessage((m) => m.content === 'e2e test message');
    expect(msg).toBeDefined();

    await env.disconnect();
  });

  it('should send a message to a specific chat', async () => {
    await env.addChat('specific-chat', 'default');
    await env.connect('specific-chat');

    const { stdout, code } = await env.runCli([
      'messages',
      'send',
      'specific chat message',
      '--chat',
      'specific-chat',
    ]);

    expect(code).toBe(0);
    expect(stdout).toContain('Message sent successfully.');

    const msg = await env.waitForMessage((m) => m.content === 'specific chat message');
    expect(msg).toBeDefined();

    await env.disconnect();
  });

  it('should send a message with a specific session ID', async () => {
    await env.addChat('session-chat', 'default');
    await env.connect('session-chat');

    const { stdout, code } = await env.runCli([
      'messages',
      'send',
      'session test message',
      '--chat',
      'session-chat',
      '--session',
      'my-test-session',
    ]);

    expect(code).toBe(0);
    expect(stdout).toContain('Message sent successfully.');

    const msg = await env.waitForMessage((m) => m.content === 'session test message');
    expect(msg).toBeDefined();

    await env.disconnect();
  });

  it('should send a message with a specific agent and persist it', async () => {
    await env.runCli(['agents', 'add', 'custom-agent', '--env', 'CUSTOM_VAR=HELLO']);
    await env.addChat('agent-chat', 'default'); // default agent initially
    await env.connect('agent-chat');

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

    await env.disconnect();
  });

  it('should send a message with a file attachment', async () => {
    await env.addChat('file-chat', 'default');
    await env.connect('file-chat');

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

    const msg = await env.waitForMessage(
      (m) =>
        !!(m.content && m.content.includes('here is a file') && m.content.includes('test-attach'))
    );
    expect(msg).toBeDefined();

    await env.disconnect();
  });

  it('should view history with tail and --json flag', async () => {
    const { stdout, code } = await env.runCli(['messages', 'tail', '--chat', 'specific-chat']);
    expect(code).toBe(0);
    expect(stdout).toContain('[USER]');
    expect(stdout).toContain('specific chat message');

    const { stdout: jsonStdout, code: jsonCode } = await env.runCli([
      'messages',
      'tail',
      '--json',
      '--chat',
      'specific-chat',
    ]);
    expect(jsonCode).toBe(0);
    expect(jsonStdout).toContain('"role":"user"');
    expect(jsonStdout).toContain('"content":"specific chat message"');
  });

  it('should return immediately with --no-wait flag', async () => {
    await env.addChat('nowait-chat', 'default');
    await env.connect('nowait-chat');

    const { stdout, code } = await env.runCli([
      'messages',
      'send',
      'no wait message',
      '--chat',
      'nowait-chat',
      '--no-wait',
    ]);

    expect(code).toBe(0);
    expect(stdout).toContain('Message sent successfully.');

    const msg = await env.waitForMessage((m) => m.content === 'no wait message');
    expect(msg).toBeDefined();

    await env.disconnect();
  });

  it('should maintain atomic ordering of user and log messages with --no-wait', async () => {
    const settings = env.getSettings();
    const oldCmd = settings.defaultAgent?.commands?.new;

    settings.defaultAgent = typeof settings.defaultAgent === 'object' ? settings.defaultAgent : {};
    settings.defaultAgent.commands = settings.defaultAgent.commands || {};
    settings.defaultAgent.commands.new = 'sleep 1 && echo $CLAW_CLI_MESSAGE';
    env.writeSettings(settings);

    await env.addChat('order-chat', 'default');
    await env.connect('order-chat');

    await env.runCli(['messages', 'send', 'first', '--chat', 'order-chat', '--no-wait']);
    await env.runCli(['messages', 'send', 'second', '--chat', 'order-chat', '--no-wait']);

    // We wait for the second command log to arrive.
    // The messages buffer will collect all messages as they arrive via SSE.
    await env.waitForMessage(
      (m) => !!(m.role === 'command' && m.content && m.content.trim() === 'second')
    );

    // Retrieve the stored messages via trpcClient to ensure final ordering on disk
    const storedMessages = await env.trpcClient!.getMessages.query({ chatId: 'order-chat' });

    settings.defaultAgent.commands.new = oldCmd;
    env.writeSettings(settings);

    const commandLogs = storedMessages.filter((m) => m.role === 'command');
    expect(commandLogs).toHaveLength(2);
    expect(storedMessages[0]!.role).toBe('user');
    expect(storedMessages[0]!.content).toBe('first');
    expect(storedMessages[1]!.role).toBe('user');
    expect(storedMessages[1]!.content).toBe('second');
    expect(commandLogs[0]!.content.trim()).toBe('first');
    expect(commandLogs[1]!.content.trim()).toBe('second');

    await env.disconnect();
  }, 10000);

  it('should handle full multi-message session workflow (extraction & append)', async () => {
    const settings = env.getSettings();
    const oldCmds = settings.defaultAgent?.commands || {};

    settings.defaultAgent = typeof settings.defaultAgent === 'object' ? settings.defaultAgent : {};
    settings.defaultAgent.commands = {
      new: 'echo "NEW $CLAW_CLI_MESSAGE" && echo "ERR NEW" >&2',
      append: 'echo "APPEND $CLAW_CLI_MESSAGE" && echo "ERR APPEND" >&2',
      getSessionId: 'echo "session-123"',
      getMessageContent: 'sed "s/^/EXTRACTED-/"',
    };
    env.writeSettings(settings);

    await env.addChat('workflow-chat', 'default');
    await env.connect('workflow-chat');

    await env.runCli(['messages', 'send', 'msg-1', '--chat', 'workflow-chat']);

    const log1 = await env.waitForMessage(
      (m) =>
        !!(
          m.role === 'command' &&
          (m as CommandLogMessage).command &&
          (m as CommandLogMessage).command.includes('ERR NEW')
        )
    );
    expect((log1 as CommandLogMessage).command).toBe(
      'echo "NEW $CLAW_CLI_MESSAGE" && echo "ERR NEW" >&2'
    );
    expect((log1 as CommandLogMessage).content).toContain('EXTRACTED-NEW msg-1');
    expect((log1 as CommandLogMessage).stderr).toContain('ERR NEW');
    expect((log1 as CommandLogMessage).stdout).toContain('NEW msg-1');

    const sessionSettings = env.getSessionSettings('default', 'default');
    expect(sessionSettings.env?.SESSION_ID).toBe('session-123');

    await env.runCli(['messages', 'send', 'msg-2', '--chat', 'workflow-chat']);

    const log2 = await env.waitForMessage(
      (m) =>
        !!(
          m.role === 'command' &&
          (m as CommandLogMessage).command &&
          (m as CommandLogMessage).command.includes('ERR APPEND')
        )
    );
    expect((log2 as CommandLogMessage).command).toBe(
      'echo "APPEND $CLAW_CLI_MESSAGE" && echo "ERR APPEND" >&2'
    );
    expect((log2 as CommandLogMessage).content).toContain('EXTRACTED-APPEND msg-2');
    expect((log2 as CommandLogMessage).stderr).toContain('ERR APPEND');
    expect((log2 as CommandLogMessage).stdout).toContain('APPEND msg-2');

    settings.defaultAgent.commands.getMessageContent = 'echo "EXTRACTION_FAIL" >&2 && exit 1';
    env.writeSettings(settings);

    await env.runCli(['messages', 'send', 'msg-3', '--chat', 'workflow-chat']);

    // wait for 3rd command log
    const log3 = await env.waitForMessage(
      (m) =>
        !!(
          m.role === 'command' &&
          (m as CommandLogMessage).stderr &&
          (m as CommandLogMessage).stderr.includes('EXTRACTION_FAIL')
        )
    );
    expect((log3 as CommandLogMessage).stdout).toContain('APPEND msg-3');
    expect((log3 as CommandLogMessage).stderr).toContain('ERR APPEND');
    expect((log3 as CommandLogMessage).stderr).toContain(
      'getMessageContent failed: EXTRACTION_FAIL'
    );

    settings.defaultAgent.commands = oldCmds;
    env.writeSettings(settings);

    await env.disconnect();
  }, 15000);
});
