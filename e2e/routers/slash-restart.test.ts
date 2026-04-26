import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
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

function readPid(pidPath: string): string {
  return fs.readFileSync(pidPath, 'utf-8').trim().split(':')[0] ?? '';
}

function readPackageVersion(): string {
  const pkgPath = path.resolve(__dirname, '../../package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { version: string };
  return pkg.version;
}

describe('/restart router e2e', () => {
  let env: TestEnvironment;

  beforeAll(async () => {
    env = new TestEnvironment('e2e-slash-restart');
    await env.setup();
    await env.init();
  }, 30000);

  afterAll(async () => {
    await env.teardown();
  }, 30000);

  it('restarts the daemon and posts a "restarted vX.Y.Z" reply', async () => {
    const { code } = await env.runCli(['serve', '--detach']);
    expect(code).toBe(0);

    const pidPath = env.getClawminiPath('supervisor.pid');
    const socketPath = env.getClawminiPath('daemon.sock');
    expect(await waitUntil(() => fs.existsSync(pidPath), 5000)).toBe(true);
    expect(await waitUntil(() => fs.existsSync(socketPath), 10000)).toBe(true);

    const supervisorPidBefore = readPid(pidPath);
    expect(supervisorPidBefore).toMatch(/^\d+$/);

    await env.sendMessage('/restart', { noWait: true });

    // The supervisor's pid file is preserved across a daemon-only restart.
    // The daemon socket disappears (old daemon dies) and reappears (new
    // daemon binds). Watch for the disappearance + reappearance to confirm
    // we actually restarted, then check the post-restart reply landed.
    const chatLog = env.getChatPath('default', 'chat.jsonl');
    const expectedVersion = readPackageVersion();

    const sawPostRestart = await waitUntil(() => {
      const lines = readChatLog(chatLog);
      return lines.some(
        (l) =>
          l.role === 'system' &&
          typeof l.content === 'string' &&
          l.content === `Clawmini restarted (v${expectedVersion}).`
      );
    }, 45000);
    expect(sawPostRestart).toBe(true);

    // Pre-restart ack should also be present.
    const lines = readChatLog(chatLog);
    expect(
      lines.some(
        (l) => typeof l.content === 'string' && l.content.includes('Restarting clawmini daemon')
      )
    ).toBe(true);

    // Supervisor pid must be unchanged — only the daemon child was replaced.
    expect(fs.existsSync(pidPath)).toBe(true);
    expect(readPid(pidPath)).toBe(supervisorPidBefore);

    // Daemon socket should be live again.
    expect(fs.existsSync(socketPath)).toBe(true);

    // Pending replies file must be drained.
    const pendingPath = env.getClawminiPath('pending-replies.json');
    expect(fs.existsSync(pendingPath)).toBe(false);
  }, 90000);
});
