import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createE2EContext, setupSubagentEnv, waitForMessage } from './utils.js';

const { runCli, e2eDir, setupE2E, teardownE2E } = createE2EContext('e2e-smart-output');

function dumpChatLog(chatId: string) {
  const logPath = path.resolve(e2eDir, `.clawmini/chats/${chatId}/chat.jsonl`);
  if (fs.existsSync(logPath)) {
    console.log(`[DEBUG] chat.jsonl for ${chatId}:`);
    console.log(fs.readFileSync(logPath, 'utf8'));
  } else {
    console.log(`[DEBUG] chat.jsonl NOT FOUND at ${logPath}`);
  }
}

function dumpDaemonLogs() {
  const daemonLog = path.resolve(e2eDir, '.clawmini/daemon.log');
  if (fs.existsSync(daemonLog)) {
    const content = fs.readFileSync(daemonLog, 'utf8');
    // Last 50 lines to keep output manageable
    const lines = content.split('\n');
    console.log(`[DEBUG] daemon.log (last 50 of ${lines.length} lines):`);
    console.log(lines.slice(-50).join('\n'));
  } else {
    console.log(`[DEBUG] daemon.log NOT FOUND at ${daemonLog}`);
  }
}

describe('Smart Output E2E', () => {
  beforeAll(async () => {
    await setupE2E();
    await setupSubagentEnv(runCli, e2eDir, {
      port: 3017,
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

  afterAll(teardownE2E, 30000);

  it('should return inline output for < 500 characters', async () => {
    await runCli(['chats', 'add', 'chat-short']);

    await runCli([
      'messages',
      'send',
      `clawmini-lite.js request short-cmd`,
      '--chat',
      'chat-short',
      '--agent',
      'debug-agent',
    ]);

    const replyMsg = await waitForMessage(
      e2eDir,
      'chat-short',
      (m: Record<string, unknown>) => m.role === 'agent'
    );
    expect(replyMsg).not.toBeNull();
    expect(replyMsg!.content).toContain('[DEBUG] clawmini-lite.js request short-cmd');
    expect(replyMsg!.content).toContain('short output');
  }, 30000);

  it('should intercept large stdout and return a summary string', async () => {
    console.log('[DEBUG] creating chat-long-out');
    await runCli(['chats', 'add', 'chat-long-out']);
    console.log('[DEBUG] chat created, sending message');

    const sendResult = await runCli([
      'messages',
      'send',
      `clawmini-lite.js request long-cmd`,
      '--chat',
      'chat-long-out',
      '--agent',
      'debug-agent',
    ]);
    console.log('[DEBUG] send result:', JSON.stringify(sendResult));

    const replyMsg = await waitForMessage(
      e2eDir,
      'chat-long-out',
      (m: Record<string, unknown>) => m.role === 'policy' && m.status === 'approved'
    );
    console.log('[DEBUG] waitForMessage result:', JSON.stringify(replyMsg));

    expect(replyMsg).not.toBeNull();
    expect(replyMsg!.content).toMatch(
      /stdout is 60\d characters, saved to \.\/tmp\/stdout-[a-zA-Z0-9-]+\.txt/
    );

    // Try reading the file
    dumpChatLog('chat-long-out');
    dumpDaemonLogs();
    console.log('[DEBUG] sending cat command (was: more)');

    const catResult = await runCli([
      'messages',
      'send',
      `cat ./tmp/stdout-${replyMsg!.requestId}.txt`,
      '--chat',
      'chat-long-out',
      '--agent',
      'debug-agent',
    ]);
    console.log('[DEBUG] cat send result:', JSON.stringify(catResult));

    const replyMsg2 = await waitForMessage(
      e2eDir,
      'chat-long-out',
      (m: Record<string, unknown>) =>
        m.role === 'agent' &&
        typeof m.content === 'string' &&
        m.content.includes('cat ./tmp/stdout-')
    );
    console.log('[DEBUG] waitForMessage2 result:', JSON.stringify(replyMsg2));
    dumpChatLog('chat-long-out');
    dumpDaemonLogs();

    expect(replyMsg2).not.toBeNull();
    expect(replyMsg2!.content).toContain('a'.repeat(600));
  }, 30000);

  it('should intercept large stderr and return a summary string', async () => {
    dumpDaemonLogs();
    console.log('[DEBUG] creating chat-long-err');
    await runCli(['chats', 'add', 'chat-long-err']);
    console.log('[DEBUG] chat created, sending message');

    const sendResult = await runCli([
      'messages',
      'send',
      `clawmini-lite.js request long-err`,
      '--chat',
      'chat-long-err',
      '--agent',
      'debug-agent',
    ]);
    console.log('[DEBUG] send result:', JSON.stringify(sendResult));

    const replyMsg = await waitForMessage(
      e2eDir,
      'chat-long-err',
      (m: Record<string, unknown>) => m.role === 'policy' && m.status === 'approved'
    );
    console.log('[DEBUG] waitForMessage result:', JSON.stringify(replyMsg));
    dumpChatLog('chat-long-err');
    dumpDaemonLogs();

    expect(replyMsg).not.toBeNull();
    expect(replyMsg!.content).toMatch(
      /stderr is 60\d characters, saved to \.\/tmp\/stderr-[a-zA-Z0-9-]+\.txt/
    );
  }, 30000);
});
