import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createE2EContext } from './utils.js';
import fs from 'node:fs';
import path from 'node:path';

const { runCli, e2eDir, setupE2E, teardownE2E } = createE2EContext('e2e-session-timeout');

describe('Session Timeout E2E', () => {
  beforeAll(async () => {
    await setupE2E();
    await runCli(['init']);

    // 1. Override settings to configure the router with a 2-second timeout
    const settingsPath = path.join(e2eDir, '.clawmini', 'settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));

    // Replace the default string config with an object config
    settings.routers = settings.routers.map((router: string | any) => {
      if (router === '@clawmini/session-timeout') {
        return {
          use: '@clawmini/session-timeout',
          with: { timeout: '2s' },
        };
      }
      return router;
    });

    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  }, 30000);

  afterAll(async () => {
    await teardownE2E();
  }, 30000);

  it('should automatically trigger a timeout reply after the specified duration', async () => {
    // 2. Send an initial message to trigger the router pipeline
    const { code } = await runCli(['messages', 'send', 'Hello daemon!']);
    expect(code).toBe(0);

    // 3. Verify the timeout job was scheduled
    const { stdout: jobsList } = await runCli(['jobs', 'list']);
    expect(jobsList).toContain('__session_timeout__');

    // 4. Wait for the 2-second timeout job to execute
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // 5. Tail the chat history to verify the timeout message was automatically appended
    const { stdout: history } = await runCli(['messages', 'tail']);

    // Validate the automated reply was sent
    expect(history).toContain('[@clawmini/session-timeout] Starting a fresh session...');
  }, 10000);
});
