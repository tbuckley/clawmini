import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import {
  TestEnvironment,
  type ChatSubscription,
  commandMatching,
  commandWith,
} from '../_helpers/test-environment.js';

// Exercises the subagent lifecycle commands (send, wait, stop, delete, list,
// tail) from a parent agent's perspective, plus the completion-notification
// paths (sync, wait-before/after completion, parent busy/idle on completion).
// Spawn + async happy-path is already covered by session-timeout-subagents.test.ts.

describe('E2E Subagent Lifecycle', () => {
  let env: TestEnvironment;
  let chat: ChatSubscription | undefined;

  beforeAll(async () => {
    env = new TestEnvironment('e2e-subagent-lifecycle');
    await env.setup();
    await env.setupSubagentEnv();
  }, 30000);

  afterAll(() => env.teardown(), 30000);
  afterEach(() => env.disconnectAll());

  it('send delivers a follow-up message to an existing subagent session', async () => {
    await env.addChat('send-chat', 'debug-agent');
    chat = await env.connect('send-chat');

    await env.sendMessage(
      'clawmini-lite.js subagents spawn --id send-sub --async "echo first-msg"',
      { chat: 'send-chat', agent: 'debug-agent' }
    );
    // First message through the subagent runs via `new` (no SESSION_ID yet).
    await chat.waitForMessage(
      commandMatching((m) => !!m.subagentId && m.stdout.includes('[DEBUG] echo first-msg:'))
    );

    await env.sendMessage('clawmini-lite.js subagents send send-sub --async -p "echo second-msg"', {
      chat: 'send-chat',
      agent: 'debug-agent',
    });
    // Follow-up runs via `append`, so the prefix is `[DEBUG <sessionId>]`.
    const followUp = await chat.waitForMessage(
      commandMatching((m) => !!m.subagentId && m.stdout.includes('echo second-msg'))
    );
    expect(followUp.stdout).toMatch(/\[DEBUG [^\]]+\] echo second-msg:/);
  }, 30000);

  it('wait returns the completed subagent output to the caller', async () => {
    await env.addChat('wait-chat', 'debug-agent');
    chat = await env.connect('wait-chat');

    await env.sendMessage(
      'clawmini-lite.js subagents spawn --id wait-sub --async "echo wait-complete"',
      { chat: 'wait-chat', agent: 'debug-agent' }
    );
    await chat.waitForMessage(
      commandMatching((m) => !!m.subagentId && m.stdout.includes('wait-complete'))
    );

    await env.sendMessage('clawmini-lite.js subagents wait wait-sub', {
      chat: 'wait-chat',
      agent: 'debug-agent',
    });

    // `subagents wait` prints the subagent's last agent reply (the debug
    // template's full stdout) back to the parent. That output is wrapped by
    // the parent's own debug invocation in this chat's command log.
    const waitLog = await chat.waitForMessage(
      commandMatching(
        (m) =>
          !m.subagentId &&
          m.stdout.includes('subagents wait wait-sub:') &&
          m.stdout.includes('wait-complete')
      )
    );
    expect(waitLog.exitCode).toBe(0);
  }, 30000);

  it('stop aborts an active subagent task before it finishes', async () => {
    await env.addChat('stop-chat', 'debug-agent');
    chat = await env.connect('stop-chat');

    // Long-running subagent command so we can stop it mid-flight.
    await env.sendMessage(
      'clawmini-lite.js subagents spawn --id stop-sub --async "sleep 30 && echo should-not-print"',
      { chat: 'stop-chat', agent: 'debug-agent' }
    );
    for (let i = 0; i < 50; i++) {
      const settings = env.getChatSettings('stop-chat') as {
        subagents?: Record<string, { status: string }>;
      };
      if (settings.subagents?.['stop-sub']?.status === 'active') break;
      await new Promise((r) => setTimeout(r, 100));
    }

    await env.sendMessage('clawmini-lite.js subagents stop stop-sub', {
      chat: 'stop-chat',
      agent: 'debug-agent',
    });
    await chat.waitForMessage(commandWith('Subagent stop-sub stopped'));

    // Abort must take the subagent out of the active state well before the
    // 30s sleep would have finished. (executeDirectMessage swallows the
    // AbortError, so the tracker settles at 'completed' rather than 'failed'.)
    let finalStatus: string | undefined;
    for (let i = 0; i < 50; i++) {
      const settings = env.getChatSettings('stop-chat') as {
        subagents?: Record<string, { status: string }>;
      };
      finalStatus = settings.subagents?.['stop-sub']?.status;
      if (finalStatus && finalStatus !== 'active') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(finalStatus).not.toBe('active');
    expect(finalStatus).toBeDefined();

    // The aborted command must never have reached its echo. The literal text
    // "should-not-print" appears in the debug template's prefix echo of the
    // spawn command, so we only count exact standalone-line matches — which
    // only come from the eval output itself.
    expect(
      chat.messageBuffer.some(
        (m) =>
          typeof (m as { stdout?: string }).stdout === 'string' &&
          /^should-not-print$/m.test((m as { stdout?: string }).stdout!)
      )
    ).toBe(false);
  }, 30000);

  it('delete removes the subagent tracker from chat settings', async () => {
    await env.addChat('delete-chat', 'debug-agent');
    chat = await env.connect('delete-chat');

    await env.sendMessage(
      'clawmini-lite.js subagents spawn --id del-sub --async "echo delete-me"',
      { chat: 'delete-chat', agent: 'debug-agent' }
    );
    await chat.waitForMessage(
      commandMatching((m) => !!m.subagentId && m.stdout.includes('delete-me'))
    );

    let settings = env.getChatSettings('delete-chat') as {
      subagents?: Record<string, unknown>;
    };
    expect(settings.subagents?.['del-sub']).toBeTruthy();

    await env.sendMessage('clawmini-lite.js subagents delete del-sub', {
      chat: 'delete-chat',
      agent: 'debug-agent',
    });
    await chat.waitForMessage(commandWith('Subagent del-sub deleted'));

    for (let i = 0; i < 50; i++) {
      settings = env.getChatSettings('delete-chat') as {
        subagents?: Record<string, unknown>;
      };
      if (!settings.subagents?.['del-sub']) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(settings.subagents?.['del-sub']).toBeUndefined();
  }, 30000);

  it('list returns all subagents spawned by the current agent', async () => {
    await env.addChat('list-chat', 'debug-agent');
    chat = await env.connect('list-chat');

    await env.sendMessage('clawmini-lite.js subagents spawn --id list-a --async "echo a"', {
      chat: 'list-chat',
      agent: 'debug-agent',
    });
    await chat.waitForMessage(
      commandMatching((m) => !!m.subagentId && m.stdout.includes('[DEBUG] echo a:'))
    );

    await env.sendMessage('clawmini-lite.js subagents spawn --id list-b --async "echo b"', {
      chat: 'list-chat',
      agent: 'debug-agent',
    });
    await chat.waitForMessage(
      commandMatching((m) => !!m.subagentId && m.stdout.includes('[DEBUG] echo b:'))
    );

    await env.sendMessage('clawmini-lite.js subagents list --json', {
      chat: 'list-chat',
      agent: 'debug-agent',
    });
    const listLog = await chat.waitForMessage(
      commandMatching(
        (m) =>
          !m.subagentId &&
          m.stdout.includes('subagents list --json:') &&
          m.stdout.includes('"id": "list-a"') &&
          m.stdout.includes('"id": "list-b"')
      )
    );
    expect(listLog.stdout).toContain('"status": "completed"');
  }, 30000);

  it('tail returns the subagent chat log to the caller', async () => {
    await env.addChat('tail-chat', 'debug-agent');
    chat = await env.connect('tail-chat');

    await env.sendMessage(
      'clawmini-lite.js subagents spawn --id tail-sub --async "echo tail-content"',
      { chat: 'tail-chat', agent: 'debug-agent' }
    );
    await chat.waitForMessage(
      commandMatching((m) => !!m.subagentId && m.stdout.includes('tail-content'))
    );

    await env.sendMessage('clawmini-lite.js subagents tail tail-sub --json', {
      chat: 'tail-chat',
      agent: 'debug-agent',
    });

    // `subagents tail --json` prints the subagent's chat log as JSONL. The
    // parent's debug wrapper echoes `[DEBUG] <cmd>:` then the command stdout,
    // so the subagent's log messages appear in this chat's command log.
    const tailLog = await chat.waitForMessage(
      commandMatching(
        (m) =>
          !m.subagentId &&
          m.stdout.includes('subagents tail tail-sub --json:') &&
          m.stdout.includes('tail-content')
      )
    );
    expect(tailLog.exitCode).toBe(0);
    // Must include both the user prompt and an agent reply from the subagent's
    // own log, not just an echo of the tail command itself.
    expect(tailLog.stdout).toMatch(/"role":\s*"user"/);
    expect(tailLog.stdout).toMatch(/"role":\s*"agent"/);
  }, 30000);

  it('list from a subagent returns only its own children, not peers or parents', async () => {
    await env.addChat('nested-list-chat', 'debug-agent');
    chat = await env.connect('nested-list-chat');

    // Parent spawns outer-sub. outer-sub itself spawns inner-sub (its child)
    // and then calls `subagents list --json`. From outer-sub's perspective,
    // only inner-sub should appear (parentId === outer-sub).
    await env.sendMessage(
      'clawmini-lite.js subagents spawn --id outer-sub --async "clawmini-lite.js subagents spawn --id inner-sub --async \\"echo inner-done\\" && sleep 1 && clawmini-lite.js subagents list --json"',
      { chat: 'nested-list-chat', agent: 'debug-agent' }
    );

    // outer-sub's own command log (subagentId=outer-sub) must contain the
    // JSON output of its own `list` call, showing inner-sub.
    const outerLog = await chat.waitForMessage(
      commandMatching(
        (m) => !!m.subagentId && m.stdout.includes('"id": "inner-sub"')
      )
    );
    expect(outerLog.stdout).toContain('"id": "inner-sub"');
    // outer-sub is its own parent, not its own child — must not appear in
    // its own list output.
    expect(outerLog.stdout).not.toMatch(/"id":\s*"outer-sub"/);

    // Parent's view: list must include outer-sub (direct child) but not
    // inner-sub (grandchild — parentId=outer-sub, not undefined).
    await env.sendMessage('clawmini-lite.js subagents list --json', {
      chat: 'nested-list-chat',
      agent: 'debug-agent',
    });
    const parentLog = await chat.waitForMessage(
      commandMatching(
        (m) =>
          !m.subagentId &&
          m.stdout.includes('subagents list --json:') &&
          m.stdout.includes('"id": "outer-sub"')
      )
    );
    expect(parentLog.stdout).toContain('"id": "outer-sub"');
    expect(parentLog.stdout).not.toMatch(/"id":\s*"inner-sub"/);
  }, 30000);

  it('sync spawn blocks the caller and returns <subagent_output> inline', async () => {
    await env.addChat('sync-chat', 'debug-agent');
    chat = await env.connect('sync-chat');

    // The router's default is `isAsync = input.async ?? depth === 0`, so a
    // spawn WITHOUT --async runs sync only when depth > 0. We trigger this
    // by having an outer subagent spawn sync-inner without --async. The
    // inner call's CLI then polls subagentWait and prints the completed
    // output wrapped in <subagent_output>...</subagent_output> tags.
    await env.sendMessage(
      'clawmini-lite.js subagents spawn --id sync-outer --async "clawmini-lite.js subagents spawn --id sync-inner \\"echo sync-value\\""',
      { chat: 'sync-chat', agent: 'debug-agent' }
    );

    // sync-outer's stdout (subagentId=sync-outer) should contain both the
    // <subagent_output> wrapper and the inner's echo value.
    const outerLog = await chat.waitForMessage(
      commandMatching(
        (m) =>
          !!m.subagentId &&
          m.stdout.includes('<subagent_output>') &&
          m.stdout.includes('sync-value')
      )
    );
    expect(outerLog.stdout).toContain('</subagent_output>');
  }, 30000);

  it('wait called before subagent finishes blocks until completion', async () => {
    await env.addChat('wait-before-chat', 'debug-agent');
    chat = await env.connect('wait-before-chat');

    // Chain spawn && wait in the same shell so `wait` is called while the
    // subagent is still sleeping. This exercises the event-iterator path
    // of subagentWait (not the synchronous early-return hit by the
    // `wait returns the completed subagent output` test above).
    await env.sendMessage(
      'clawmini-lite.js subagents spawn --id wait-before-sub --async "sleep 3 && echo slow-done" && clawmini-lite.js subagents wait wait-before-sub',
      { chat: 'wait-before-chat', agent: 'debug-agent' }
    );

    // The parent's wrapped stdout contains the wait-returned subagent
    // output (the debug template's own echo of `sleep 3 && echo slow-done`).
    // That specific prefix only appears when wait actually returned with
    // the subagent's agent-role content — it does not appear in the
    // parent's own debug-echo of the outer command line.
    const waitLog = await chat.waitForMessage(
      commandMatching(
        (m) =>
          !m.subagentId &&
          m.stdout.includes('[DEBUG] sleep 3 && echo slow-done:')
      ),
      20000
    );
    expect(waitLog.exitCode).toBe(0);
  }, 30000);

  it('notifies the parent session when an async subagent completes during parent work', async () => {
    await env.addChat('notify-busy-chat', 'debug-agent');
    chat = await env.connect('notify-busy-chat');

    // Parent spawns a fast subagent then sleeps longer than the subagent
    // takes. The subagent finishes while the parent's shell command is
    // still running and the parent never calls `wait`. Current behavior:
    // executeSubagent injects a <notification> message into the parent's
    // session via executeDirectMessage (subagent-utils.ts:101).
    await env.sendMessage(
      'clawmini-lite.js subagents spawn --id notify-busy-sub --async "echo notify-done-early" && sleep 2 && echo parent-still-working',
      { chat: 'notify-busy-chat', agent: 'debug-agent' }
    );

    // The notification text must land in the parent chat regardless of
    // which message role carries it (debug-agent may shell-eval the
    // notification body — see the TODO at subagent-utils.ts:98-100).
    await chat.waitForMessage(
      (m) => JSON.stringify(m).includes('Subagent notify-busy-sub completed'),
      15000
    );
  }, 30000);

  it('notifies the parent session when an async subagent completes after parent is idle', async () => {
    await env.addChat('notify-idle-chat', 'debug-agent');
    chat = await env.connect('notify-idle-chat');

    // Parent spawns a slow subagent and the parent's shell command
    // returns immediately — the parent is idle by the time the subagent
    // finishes ~2s later. The async completion path still injects the
    // notification into the parent session.
    await env.sendMessage(
      'clawmini-lite.js subagents spawn --id notify-idle-sub --async "sleep 2 && echo late-done"',
      { chat: 'notify-idle-chat', agent: 'debug-agent' }
    );
    // Confirm parent has returned (spawn CLI prints this line immediately
    // after registering the subagent; it does NOT wait for completion).
    await chat.waitForMessage(
      commandMatching(
        (m) =>
          !m.subagentId &&
          m.stdout.includes('Subagent spawned successfully with ID: notify-idle-sub')
      )
    );

    // Then, once the subagent finishes, the notification arrives.
    await chat.waitForMessage(
      (m) => JSON.stringify(m).includes('Subagent notify-idle-sub completed'),
      15000
    );
  }, 30000);

  it('waiting on two subagents sequentially returns each one\'s output inline', async () => {
    await env.addChat('two-wait-chat', 'debug-agent');
    chat = await env.connect('two-wait-chat');

    // Spawn two async subagents, then wait on each in turn. Each wait
    // call prints its OWN subagent's last agent-role message via the
    // CLI's stdout — so the parent's wrapped stdout must contain both
    // subagents' debug-template echoes, in order.
    await env.sendMessage(
      'clawmini-lite.js subagents spawn --id two-a --async "echo both-output-a" && clawmini-lite.js subagents spawn --id two-b --async "echo both-output-b" && clawmini-lite.js subagents wait two-a && clawmini-lite.js subagents wait two-b',
      { chat: 'two-wait-chat', agent: 'debug-agent' }
    );

    // `[DEBUG] echo both-output-a:` only appears inside the subagent's
    // own log (printed back by wait), not in the parent's outer echo of
    // the chained command — same logic as the `wait-before` test above.
    const log = await chat.waitForMessage(
      commandMatching(
        (m) =>
          !m.subagentId &&
          m.stdout.includes('[DEBUG] echo both-output-a:') &&
          m.stdout.includes('[DEBUG] echo both-output-b:')
      ),
      20000
    );
    const aIdx = log.stdout.indexOf('[DEBUG] echo both-output-a:');
    const bIdx = log.stdout.indexOf('[DEBUG] echo both-output-b:');
    expect(aIdx).toBeGreaterThanOrEqual(0);
    // wait(a) runs before wait(b), so A's wait output appears first.
    expect(bIdx).toBeGreaterThan(aIdx);
  }, 30000);
});
