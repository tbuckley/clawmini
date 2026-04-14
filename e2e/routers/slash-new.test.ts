import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { createE2EContext } from '../_helpers/utils.js';

const { runCli, e2eDir, setupE2E, teardownE2E } = createE2EContext('e2e-slash-new');

describe('/new Command E2E', () => {
  beforeAll(async () => {
    await setupE2E();
    await runCli(['init', '--agent', 'test-agent', '--agent-template', 'debug']);

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

  it('should reset the session ID when /new is sent', async () => {
    // 1. Send an initial message
    const { code } = await runCli(['messages', 'send', 'message 1']);
    expect(code).toBe(0); // 2. Send another message to get an append
    await runCli(['messages', 'send', 'message 2']);

    // Get the first session ID
    const { stdout: history } = await runCli(['messages', 'tail', '-n', '30', '--json']);
    let messages = getMessages(history);

    const msg1Log = getAgentResponse(messages, 'message 1');
    expect(msg1Log).toBeDefined();
    const msg2Log = getAgentResponse(messages, 'message 2');
    expect(msg2Log).toBeDefined();

    // message 2 should be appended to the first session
    const firstSessionMatch = msg2Log.content.match(/\[DEBUG APPEND (.*?)\]/);
    expect(firstSessionMatch).toBeTruthy();
    const firstSessionId = firstSessionMatch[1];
    expect(firstSessionId).toBeTruthy();

    // 3. Send /new
    await runCli(['messages', 'send', '/new']);

    // 4. Send a third message
    await runCli(['messages', 'send', 'message 3']);

    // 5. Check the session ID of the third message
    const { stdout: history2 } = await runCli(['messages', 'tail', '-n', '30', '--json']);
    messages = getMessages(history2);

    const msg3Log = getAgentResponse(messages, 'message 3');
    expect(msg3Log).toBeDefined();

    // Because it's a new session, it should use the 'new' command
    expect(msg3Log.content).toContain('[DEBUG NEW ]');

    // It should NOT be appended
    expect(msg3Log.content).not.toContain('[DEBUG APPEND');
  }, 30000);
});
