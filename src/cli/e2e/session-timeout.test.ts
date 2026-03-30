import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createE2EContext } from './utils.js';
import fs from 'node:fs';
import path from 'node:path';

const { runCli, e2eDir, setupE2E, teardownE2E } = createE2EContext('e2e-timeout');

describe('Session Timeout E2E', () => {
  beforeAll(async () => {
    await setupE2E();
    await runCli(['init', '--agent', 'test-agent', '--agent-template', 'debug']);

    // Override settings to configure the router with a 3-second timeout
    const settingsPath = path.join(e2eDir, '.clawmini', 'settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));

    // Explicitly add the custom configured router
    settings.routers = [
      {
        use: '@clawmini/session-timeout',
        with: { timeout: '5s' },
      },
    ];

    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

    // Force the test agent to succeed so that sessions actually get created!
    const agentSettingsPath = path.join(
      e2eDir,
      '.clawmini',
      'agents',
      'test-agent',
      'settings.json'
    );
    const agentSettings = JSON.parse(fs.readFileSync(agentSettingsPath, 'utf8'));
    agentSettings.commands.new = 'echo "[DEBUG NEW $SESSION_ID] $CLAW_CLI_MESSAGE"';
    agentSettings.commands.append = 'echo "[DEBUG APPEND $SESSION_ID] $CLAW_CLI_MESSAGE"';
    fs.writeFileSync(agentSettingsPath, JSON.stringify(agentSettings, null, 2));
  }, 30000);

  afterAll(async () => {
    await teardownE2E();
  }, 30000);

  function getMessages(stdout: string) {
    return stdout
      .trim()
      .split('\n')
      .filter((l) => l.trim().startsWith('{') && l.trim().endsWith('}'))
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  function getAgentResponse(messages: any[], userMessage: string) {
    return messages.find(
      (m) => m.content && m.content.includes(userMessage) && m.content.includes('[DEBUG')
    );
  }

  it('(1) sending a message and waiting for timeout, ensuring that the old session has the timeout message sent to it and new messages go to a different session. The user should be sent a system message saying that a new session has started.', async () => {
    // Send an initial message to trigger the router pipeline
    const { code } = await runCli(['messages', 'send', 'first message']);
    expect(code).toBe(0);

    // Verify the timeout job was scheduled
    const { stdout: jobsList } = await runCli(['jobs', 'list']);
    expect(jobsList).toContain('__session_timeout__');

    // Wait for the 5-second timeout job to execute
    await new Promise((resolve) => setTimeout(resolve, 5500));

    // Tail the chat history to verify the timeout message was automatically appended
    const { stdout: history1 } = await runCli(['messages', 'tail', '-n', '30', '--json']);

    // Validate the automated reply was sent
    expect(history1).toContain('[@clawmini/session-timeout] Starting a fresh session...');

    // Send another message
    await runCli(['messages', 'send', 'second message']);

    const { stdout: history2, stderr: err2 } = await runCli([
      'messages',
      'tail',
      '-n',
      '30',
      '--json',
    ]);
    const messages = getMessages(history2);
    if (messages.length === 0) console.error('RAW STDOUT:', history2, 'STDERR:', err2);

    // Check that we see the first message, the fresh session reply, and the second message as a NEW session
    const firstMsgLog = getAgentResponse(messages, 'first message');
    if (!firstMsgLog) console.error('FAILED TO FIND FIRST MSG LOG in:', messages);
    expect(firstMsgLog).toBeDefined();

    const timeoutOutput = messages.find(
      (m: any) =>
        m.content && m.content.includes('[@clawmini/session-timeout] Starting a fresh session...')
    );
    expect(timeoutOutput).toBeDefined();

    // The second message should use `commands.new`, which prints `[DEBUG NEW ] second message` because $SESSION_ID is empty
    const secondMsgLog = getAgentResponse(messages, 'second message');
    expect(secondMsgLog).toBeDefined();
    expect(secondMsgLog.content).toContain('[DEBUG NEW ]');

    // It should NOT be appended.
    const secondMsgAppended = messages.find(
      (m: any) =>
        m.content && m.content.includes('second message') && m.content.includes('[DEBUG APPEND ')
    );
    expect(secondMsgAppended).toBeUndefined();
  }, 20000);

  it('(2) sending a message, then sending /new, then sending another message. after the timeout for the first message, that session should be told to save; but the current session should still be saved. the user should NOT be sent a system message saying that a new session has started.', async () => {
    // Send an initial message
    await runCli(['messages', 'send', '--chat', 'test2', '--agent', 'test-agent', 'msg A']);

    // Send /new
    await runCli(['messages', 'send', '--chat', 'test2', '/new']);

    // Send second message immediately
    await runCli(['messages', 'send', '--chat', 'test2', 'msg B']);

    // Wait 2 seconds (so we are at 2.5s since msg A, but 2s since msg B)
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Send a keep-alive message so the new session's timeout is reset to 5s from now!
    await runCli(['messages', 'send', '--chat', 'test2', 'msg KEEP ALIVE']);

    // Wait another 3.5 seconds.
    // Now we are at ~6s since msg A (timeout FIRED).
    // We are at ~3.5s since msg KEEP ALIVE (timeout NOT FIRED).
    await new Promise((resolve) => setTimeout(resolve, 3500));
    const { stdout: history, stderr: err } = await runCli([
      'messages',
      'tail',
      '--chat',
      'test2',
      '-n',
      '30',
      '--json',
    ]);
    if (history.trim() === '') console.error('TEST 2 RAW STDOUT EMPTY', err);

    // The user should NOT be sent a system message saying that a new session has started.
    expect(history).not.toContain('[@clawmini/session-timeout] Starting a fresh session...');

    // But the background timeout prompt SHOULD have been sent for msg A!
    const messages = getMessages(history);
    if (messages.length === 0) console.error('TEST 2 NO PARSED MESSAGES. RAW:', history);

    // Find msg KEEP ALIVE and get its session ID
    const keepAliveLog = getAgentResponse(messages, 'msg KEEP ALIVE');
    expect(keepAliveLog).toBeDefined();
    const keepAliveSessionId = keepAliveLog.content.match(/\[DEBUG APPEND (.*?)\]/)?.[1];
    expect(keepAliveSessionId).toBeTruthy();

    const backgroundPrompts = messages.filter(
      (m: any) => m.content && m.content.includes('This chat session has ended.')
    );
    // We expect exactly ONE background prompt (for the old session)
    if (backgroundPrompts.length === 0)
      console.error('FAILED TO FIND BACKGROUND PROMPT in:', messages);
    expect(backgroundPrompts.length).toBeGreaterThanOrEqual(1);

    // Send a third message to check that the current session wasn't blown away by the timeout from msg A.
    await runCli(['messages', 'send', '--chat', 'test2', 'msg C']);
    const { stdout: history2 } = await runCli([
      'messages',
      'tail',
      '--chat',
      'test2',
      '-n',
      '20',
      '--json',
    ]);

    const messages2 = getMessages(history2);

    const appendedMsgLog = getAgentResponse(messages2, 'msg C');
    if (!appendedMsgLog) console.error('FAILED TO FIND APPENDED MSG LOG in:', messages2);
    expect(appendedMsgLog).toBeDefined();
    expect(appendedMsgLog.content).toContain(`[DEBUG APPEND ${keepAliveSessionId}]`);
  }, 20000);
});
