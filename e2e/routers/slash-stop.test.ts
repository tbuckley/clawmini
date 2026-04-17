import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  TestEnvironment,
  type ChatSubscription,
  commandWith,
} from '../_helpers/test-environment.js';

function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Polls for a PID file written by the spawned shell. Returns the PID once
// the file exists and contains a valid integer (avoids a flush race between
// `echo $$ > pid` and our read).
async function waitForPidFile(filePath: string, timeoutMs: number): Promise<number> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8').trim();
      if (/^\d+$/.test(content)) return parseInt(content, 10);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Timed out waiting for pid file ${filePath}`);
}

describe('/stop Router E2E', () => {
  let env: TestEnvironment;
  let chat: ChatSubscription | undefined;
  const tmpDirs: string[] = [];

  beforeAll(async () => {
    env = new TestEnvironment('e2e-slash-stop');
    await env.setup();
    await env.setupSubagentEnv();
  }, 30000);

  afterAll(async () => {
    for (const dir of tmpDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    await env.teardown();
  }, 30000);
  afterEach(() => env.disconnectAll());

  function makeTmp(label: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `claw-stop-${label}-`));
    tmpDirs.push(dir);
    return dir;
  }

  it('aborts the in-flight task and suppresses its command log', async () => {
    await env.runCli(['agents', 'add', 'stop-agent']);
    // Output lands only after the sleep, so if /stop aborts correctly, DONE
    // must never appear in the chat.
    env.writeAgentSettings('stop-agent', {
      commands: { new: 'sleep 3 && echo DONE' },
    });

    await env.addChat('stop-chat', 'stop-agent');
    chat = await env.connect('stop-chat');

    await env.sendMessage('long', { chat: 'stop-chat', noWait: true });
    // Give the scheduler a moment to dispatch into runCommand/spawn.
    await new Promise((r) => setTimeout(r, 500));

    await env.sendMessage('/stop', { chat: 'stop-chat', noWait: true });

    // The slash-stop router replies with this synthetic message before aborting.
    await chat.waitForMessage(
      (m) => typeof m.content === 'string' && m.content.includes('Stopping current task...'),
      5000
    );

    // Wait past the original sleep window so any surviving task would have
    // produced output by now.
    await new Promise((r) => setTimeout(r, 3500));
    const leaked = chat.messageBuffer.some(commandWith('DONE'));
    expect(leaked).toBe(false);
  }, 20000);

  it('leaves the session usable for subsequent messages', async () => {
    await env.runCli(['agents', 'add', 'stop-recovery-agent']);
    env.writeAgentSettings('stop-recovery-agent', {
      commands: { new: 'sleep 3 && echo DONE' },
    });

    await env.addChat('stop-recovery-chat', 'stop-recovery-agent');
    chat = await env.connect('stop-recovery-chat');

    await env.sendMessage('long', { chat: 'stop-recovery-chat', noWait: true });
    await new Promise((r) => setTimeout(r, 500));
    await env.sendMessage('/stop', { chat: 'stop-recovery-chat', noWait: true });
    await chat.waitForMessage(
      (m) => typeof m.content === 'string' && m.content.includes('Stopping current task...'),
      5000
    );

    // Swap in a fast-returning command so the follow-up test completes quickly.
    env.writeAgentSettings('stop-recovery-agent', {
      commands: { new: 'echo RECOVERED' },
    });

    await env.sendMessage('after', { chat: 'stop-recovery-chat' });
    const ok = await chat.waitForMessage(commandWith('RECOVERED'), 10000);
    expect(ok.exitCode).toBe(0);
  }, 25000);

  // The subagent tests below use file-based markers (a pid file written
  // before sleep, a leak file touched after sleep) instead of relying on
  // chat-buffer absence. This addresses three weak signals in the older
  // version of this test:
  //   1. Subagent might never have started — a no-op spawn would pass
  //      trivially. waitForPidFile asserts the subagent actually ran.
  //   2. Output suppression for unrelated reasons could mask a live
  //      subagent — the leak file is written by the OS regardless of
  //      whether output is plumbed back to the chat.
  //   3. A 500ms dispatch + 3.5s wait for a 3s sleep gives only ~500ms
  //      margin under load. The 5s sleep + 8s wait gives 3s of slack and
  //      uses a pid-file gate instead of a fixed pre-/stop sleep.
  // pidIsAlive is a corroborating signal — kernels reap killed shells fast
  // enough that within 8s `process.kill(pid, 0)` reliably throws ESRCH.

  it('aborts an active async subagent: process dies and leak marker is never written', async () => {
    const tmp = makeTmp('async');
    await env.addChat('stop-sub-async', 'debug-agent');
    chat = await env.connect('stop-sub-async');

    const cmd = `echo $$ > ${tmp}/pid && sleep 5 && touch ${tmp}/leaked`;
    await env.sendMessage(`clawmini-lite.js subagents spawn --async '${cmd}'`, {
      chat: 'stop-sub-async',
      agent: 'debug-agent',
    });

    const pid = await waitForPidFile(path.join(tmp, 'pid'), 10000);
    expect(pidIsAlive(pid)).toBe(true);

    await env.sendMessage('/stop', { chat: 'stop-sub-async', noWait: true });
    await chat.waitForMessage(
      (m) => typeof m.content === 'string' && m.content.includes('Stopping current task...'),
      5000
    );

    await new Promise((r) => setTimeout(r, 8000));
    expect(fs.existsSync(path.join(tmp, 'leaked'))).toBe(false);
    expect(pidIsAlive(pid)).toBe(false);
  }, 30000);

  it('aborts an active sync subagent and leaves the parent session usable', async () => {
    const tmp = makeTmp('sync');
    await env.addChat('stop-sub-sync', 'debug-agent');
    chat = await env.connect('stop-sub-sync');

    // No --async flag: the parent's lite invocation blocks on subagentWait,
    // so use noWait on sendMessage to avoid blocking the test runner too.
    const cmd = `echo $$ > ${tmp}/pid && sleep 5 && touch ${tmp}/leaked`;
    await env.sendMessage(`clawmini-lite.js subagents spawn '${cmd}'`, {
      chat: 'stop-sub-sync',
      agent: 'debug-agent',
      noWait: true,
    });

    const pid = await waitForPidFile(path.join(tmp, 'pid'), 10000);
    expect(pidIsAlive(pid)).toBe(true);

    await env.sendMessage('/stop', { chat: 'stop-sub-sync', noWait: true });
    await chat.waitForMessage(
      (m) => typeof m.content === 'string' && m.content.includes('Stopping current task...'),
      5000
    );

    await new Promise((r) => setTimeout(r, 8000));
    expect(fs.existsSync(path.join(tmp, 'leaked'))).toBe(false);
    expect(pidIsAlive(pid)).toBe(false);

    // Recovery: a sync spawn can wedge the parent if /stop fails to unblock
    // the parent's subagentWait poll. A follow-up message proves it didn't.
    await env.sendMessage('echo RECOVERED_SYNC', {
      chat: 'stop-sub-sync',
      agent: 'debug-agent',
    });
    const ok = await chat.waitForMessage(commandWith('RECOVERED_SYNC'), 10000);
    expect(ok.exitCode).toBe(0);
  }, 30000);

  it('aborts nested subagents at depth 2: both layers die and neither leaks', async () => {
    const tmp = makeTmp('nested');
    await env.addChat('stop-sub-nested', 'debug-agent');
    chat = await env.connect('stop-sub-nested');

    // Quoting note: this command is re-eval'd at three levels (parent
    // shell, subagent A's shell, subagent B's shell). The inner `\$\$`
    // survives the parent's outer single quotes literally, then loses one
    // backslash inside subagent A's double-quoted invocation of lite, so
    // subagent B finally sees a bare `$$` that expands to its own PID.
    const inner = `echo \\$\\$ > ${tmp}/B.pid && sleep 5 && touch ${tmp}/B.leaked`;
    const outer =
      `echo $$ > ${tmp}/A.pid && ` +
      `clawmini-lite.js subagents spawn --async "${inner}" && ` +
      `sleep 5 && touch ${tmp}/A.leaked`;

    await env.sendMessage(`clawmini-lite.js subagents spawn --async '${outer}'`, {
      chat: 'stop-sub-nested',
      agent: 'debug-agent',
    });

    const aPid = await waitForPidFile(path.join(tmp, 'A.pid'), 15000);
    const bPid = await waitForPidFile(path.join(tmp, 'B.pid'), 15000);
    expect(pidIsAlive(aPid)).toBe(true);
    expect(pidIsAlive(bPid)).toBe(true);

    await env.sendMessage('/stop', { chat: 'stop-sub-nested', noWait: true });
    await chat.waitForMessage(
      (m) => typeof m.content === 'string' && m.content.includes('Stopping current task...'),
      5000
    );

    await new Promise((r) => setTimeout(r, 8000));
    expect(fs.existsSync(path.join(tmp, 'A.leaked'))).toBe(false);
    expect(fs.existsSync(path.join(tmp, 'B.leaked'))).toBe(false);
    expect(pidIsAlive(aPid)).toBe(false);
    expect(pidIsAlive(bPid)).toBe(false);
  }, 40000);
});
