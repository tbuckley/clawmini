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

interface LogLine {
  role?: string;
  content?: string;
}

function readChatLog(filePath: string): LogLine[] {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, 'utf-8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      try {
        return JSON.parse(line) as LogLine;
      } catch {
        return {};
      }
    });
}

describe('/upgrade router e2e (dev checkout path)', () => {
  let env: TestEnvironment;

  beforeAll(async () => {
    env = new TestEnvironment('e2e-slash-upgrade');
    await env.setup();
    await env.init();
  }, 30000);

  afterAll(async () => {
    await env.teardown();
  }, 30000);

  // We deliberately don't exercise the actual `npm install -g` path in e2e —
  // it would mutate the host's globally installed clawmini. Instead we verify
  // the safety branch: when the running binary is *not* under `npm root -g`
  // (which is always true in the e2e harness, since dist/cli/index.mjs lives
  // in the repo), /upgrade must reply with a refusal and leave the
  // supervisor running.
  it('refuses the upgrade and keeps the supervisor running when not installed via npm', async () => {
    const { code } = await env.runCli(['serve', '--detach']);
    expect(code).toBe(0);

    const pidPath = env.getClawminiPath('supervisor.pid');
    const socketPath = env.getClawminiPath('daemon.sock');
    expect(await waitUntil(() => fs.existsSync(pidPath), 5000)).toBe(true);
    expect(await waitUntil(() => fs.existsSync(socketPath), 10000)).toBe(true);

    await env.sendMessage('/upgrade', { noWait: true });

    const chatLog = env.getChatPath('default', 'chat.jsonl');
    const sawRefusal = await waitUntil(() => {
      const lines = readChatLog(chatLog);
      return lines.some(
        (l) =>
          typeof l.content === 'string' &&
          l.content.includes('Cannot upgrade') &&
          l.content.includes('not installed via')
      );
    }, 15000);
    expect(sawRefusal).toBe(true);

    // Supervisor and daemon must both still be alive.
    expect(fs.existsSync(pidPath)).toBe(true);
    expect(fs.existsSync(socketPath)).toBe(true);

    // No pending reply was queued for an upgrade that never happened.
    const pendingPath = env.getClawminiPath('pending-replies.json');
    expect(fs.existsSync(pendingPath)).toBe(false);
  }, 30000);
});
