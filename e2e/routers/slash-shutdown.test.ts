import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import { TestEnvironment } from '../_helpers/test-environment.js';

async function waitUntil(
  cond: () => boolean,
  timeoutMs: number,
  intervalMs = 100
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return cond();
}

describe('/shutdown router e2e', () => {
  let env: TestEnvironment;

  beforeAll(async () => {
    env = new TestEnvironment('e2e-slash-shutdown');
    await env.setup();
    await env.init();
  }, 30000);

  afterAll(async () => {
    await env.teardown();
  }, 30000);

  it('tears down the supervisor when /shutdown is sent', async () => {
    const { code } = await env.runCli(['serve', '--detach']);
    expect(code).toBe(0);

    const pidPath = env.getClawminiPath('supervisor.pid');
    const socketPath = env.getClawminiPath('daemon.sock');
    const controlPath = env.getClawminiPath('supervisor.sock');
    expect(await waitUntil(() => fs.existsSync(pidPath), 5000)).toBe(true);
    expect(await waitUntil(() => fs.existsSync(socketPath), 10000)).toBe(true);
    expect(await waitUntil(() => fs.existsSync(controlPath), 10000)).toBe(true);

    await env.sendMessage('/shutdown', { noWait: true });

    // The supervisor exits asynchronously after ack — wait for it to clean up.
    expect(await waitUntil(() => !fs.existsSync(pidPath), 30000)).toBe(true);
    expect(await waitUntil(() => !fs.existsSync(socketPath), 30000)).toBe(true);
    expect(await waitUntil(() => !fs.existsSync(controlPath), 30000)).toBe(true);

    // The synthetic ack should have been recorded in the chat log before the
    // daemon went away.
    const chatLog = env.getChatPath('default', 'chat.jsonl');
    const content = fs.readFileSync(chatLog, 'utf-8');
    expect(content).toContain('Shutting down clawmini supervisor');
  }, 60000);
});
