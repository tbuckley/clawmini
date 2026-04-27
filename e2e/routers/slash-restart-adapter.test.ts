import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  TestEnvironment,
  type ChatMessage,
  type SystemMessage,
} from '../_helpers/test-environment.js';

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

function readPackageVersion(): string {
  const pkgPath = path.resolve(__dirname, '../../package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { version: string };
  return pkg.version;
}

function isSystemReplyContaining(text: string) {
  return (m: ChatMessage): m is SystemMessage =>
    m.role === 'system' && typeof m.content === 'string' && m.content.includes(text);
}

// Distinct from slash-restart.test.ts which only inspects the chat log on
// disk. The pending-replies → drainPendingReplies path is justified by the
// claim that adapters reconnect to the tRPC subscription with a
// lastMessageId cursor and replay the post-restart SystemMessage. This test
// exercises that path end-to-end through tRPC.
describe('/restart adapter delivery e2e', () => {
  let env: TestEnvironment;

  beforeAll(async () => {
    env = new TestEnvironment('e2e-slash-restart-adapter');
    await env.setup();
    await env.init();
  }, 30000);

  afterAll(async () => {
    await env.teardown();
  }, 30000);

  it('replays the post-restart SystemMessage to a tRPC subscriber that reconnects with lastMessageId', async () => {
    const { code } = await env.runCli(['serve', '--detach']);
    expect(code).toBe(0);

    const socketPath = env.getClawminiPath('daemon.sock');
    expect(await waitUntil(() => fs.existsSync(socketPath), 10000)).toBe(true);

    // Subscribe BEFORE sending /restart so we get the ack on the live stream.
    const sub1 = await env.connect('default');

    await env.sendMessage('/restart', { noWait: true });

    const ack = await sub1.waitForMessage(
      isSystemReplyContaining('Restarting clawmini...'),
      15000
    );
    expect(ack.id).toBeTruthy();

    // Drop the first subscription before the daemon goes down so we
    // explicitly model an adapter that reconnected. The httpSubscriptionLink
    // would otherwise try to auto-reconnect on its own and cloud the test.
    await sub1.disconnect();

    // Wait for the daemon to actually restart (socket disappears, then comes
    // back). Old daemon dies → socket gone; supervisor's restartService spins
    // up a new daemon that re-binds the socket.
    expect(await waitUntil(() => !fs.existsSync(socketPath), 30000)).toBe(true);
    expect(await waitUntil(() => fs.existsSync(socketPath), 60000)).toBe(true);

    // Reconnect with the lastMessageId cursor — exactly what the adapter
    // forwarder does when it re-establishes its subscription. The catch-up
    // path in waitForMessages should yield the post-restart SystemMessage
    // that drainPendingReplies appended on daemon startup.
    const sub2 = await env.connect('default', { lastMessageId: ack.id });

    const expectedVersion = readPackageVersion();
    const restartedMsg = await sub2.waitForMessage(
      isSystemReplyContaining(`Clawmini restarted (v${expectedVersion}).`),
      30000
    );
    expect(restartedMsg.role).toBe('system');

    await sub2.disconnect();
  }, 120000);
});
