import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import {
  TestEnvironment,
  type ChatSubscription,
  type CommandLogMessage,
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
      'clawmini-lite.js subagents spawn --id send-sub --delivery notify "echo first-msg"',
      { chat: 'send-chat', agent: 'debug-agent' }
    );
    // First message through the subagent runs via `new` (no SESSION_ID yet).
    await chat.waitForMessage(
      commandMatching((m) => !!m.subagentId && m.stdout.includes('[DEBUG] echo first-msg:'))
    );

    await env.sendMessage('clawmini-lite.js subagents send send-sub --delivery notify -p "echo second-msg"', {
      chat: 'send-chat',
      agent: 'debug-agent',
    });
    // Follow-up runs via `append`, so the prefix is `[DEBUG <sessionId>]`.
    const followUp = await chat.waitForMessage(
      commandMatching((m) => !!m.subagentId && m.stdout.includes('echo second-msg'))
    );
    expect(followUp.stdout).toMatch(/\[DEBUG [^\]]+\] echo second-msg:/);
  }, 30000);

  it('delegations wait returns the completed subagent record to the caller', async () => {
    await env.addChat('wait-chat', 'debug-agent');
    chat = await env.connect('wait-chat');

    await env.sendMessage(
      'clawmini-lite.js subagents spawn --id wait-sub --delivery notify "echo wait-complete"',
      { chat: 'wait-chat', agent: 'debug-agent' }
    );
    await chat.waitForMessage(
      commandMatching((m) => !!m.subagentId && m.stdout.includes('wait-complete'))
    );

    await env.sendMessage('clawmini-lite.js delegations wait wait-sub', {
      chat: 'wait-chat',
      agent: 'debug-agent',
    });

    // `delegations wait` prints `{resolved: [...], pending: [...]}` JSON. The
    // parent's own debug invocation wraps that around the command log, so
    // the chat's command_log must contain `"id": "wait-sub"` and the resolved
    // state.
    const waitLog = await chat.waitForMessage(
      commandMatching(
        (m) =>
          !m.subagentId &&
          m.stdout.includes('delegations wait wait-sub:') &&
          m.stdout.includes('"id": "wait-sub"') &&
          m.stdout.includes('"state": "completed"')
      )
    );
    expect(waitLog.exitCode).toBe(0);
  }, 30000);

  it('stop aborts an active subagent task before it finishes', async () => {
    await env.addChat('stop-chat', 'debug-agent');
    chat = await env.connect('stop-chat');

    // Long-running subagent command so we can stop it mid-flight.
    await env.sendMessage(
      'clawmini-lite.js subagents spawn --id stop-sub --delivery notify "sleep 30 && echo should-not-print"',
      { chat: 'stop-chat', agent: 'debug-agent' }
    );
    for (let i = 0; i < 50; i++) {
      const rec = env.readDelegation('stop-chat', 'stop-sub');
      if (rec && (rec.state as string) === 'running') break;
      await new Promise((r) => setTimeout(r, 100));
    }

    await env.sendMessage('clawmini-lite.js subagents stop stop-sub', {
      chat: 'stop-chat',
      agent: 'debug-agent',
    });
    await chat.waitForMessage(commandWith('Subagent stop-sub stopped'));

    // Stop transiently marks the delegation `failed` (the router writes it
    // before calling session.stop()), but executeDirectMessage swallows
    // the AbortError. The delegation state settles at `failed` since
    // executeSubagent's post-abort `markResolved` is a no-op when the
    // delegation is already terminal. Either way, the running sleep must
    // not have echoed.
    let finalState: string | undefined;
    for (let i = 0; i < 50; i++) {
      const rec = env.readDelegation('stop-chat', 'stop-sub');
      finalState = rec ? (rec.state as string) : undefined;
      if (finalState && finalState !== 'running' && finalState !== 'pending') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(['failed', 'completed']).toContain(finalState);

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

  it('delegations delete removes the subagent record from disk', async () => {
    await env.addChat('delete-chat', 'debug-agent');
    chat = await env.connect('delete-chat');

    await env.sendMessage(
      'clawmini-lite.js subagents spawn --id del-sub --delivery notify "echo delete-me"',
      { chat: 'delete-chat', agent: 'debug-agent' }
    );
    await chat.waitForMessage(
      commandMatching((m) => !!m.subagentId && m.stdout.includes('delete-me'))
    );

    expect(env.readDelegation('delete-chat', 'del-sub')).toBeTruthy();

    await env.sendMessage('clawmini-lite.js delegations delete del-sub', {
      chat: 'delete-chat',
      agent: 'debug-agent',
    });
    await chat.waitForMessage(commandWith('Delegation del-sub deleted'));

    let rec: Record<string, unknown> | null = null;
    for (let i = 0; i < 50; i++) {
      rec = env.readDelegation('delete-chat', 'del-sub');
      if (!rec) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(rec).toBeNull();
  }, 30000);

  it('delegations list returns all subagents spawned by the current agent', async () => {
    await env.addChat('list-chat', 'debug-agent');
    chat = await env.connect('list-chat');

    await env.sendMessage('clawmini-lite.js subagents spawn --id list-a --delivery notify "echo a"', {
      chat: 'list-chat',
      agent: 'debug-agent',
    });
    await chat.waitForMessage(
      commandMatching((m) => !!m.subagentId && m.stdout.includes('[DEBUG] echo a:'))
    );

    await env.sendMessage('clawmini-lite.js subagents spawn --id list-b --delivery notify "echo b"', {
      chat: 'list-chat',
      agent: 'debug-agent',
    });
    await chat.waitForMessage(
      commandMatching((m) => !!m.subagentId && m.stdout.includes('[DEBUG] echo b:'))
    );

    await env.sendMessage(
      'clawmini-lite.js delegations list --state resolved --kind subagent --json',
      { chat: 'list-chat', agent: 'debug-agent' }
    );
    const listLog = await chat.waitForMessage(
      commandMatching(
        (m) =>
          !m.subagentId &&
          m.stdout.includes('delegations list --state resolved --kind subagent --json:') &&
          m.stdout.includes('"id": "list-a"') &&
          m.stdout.includes('"id": "list-b"')
      )
    );
    expect(listLog.stdout).toContain('"state": "completed"');
  }, 30000);

  it('tail returns the subagent chat log to the caller', async () => {
    await env.addChat('tail-chat', 'debug-agent');
    chat = await env.connect('tail-chat');

    await env.sendMessage(
      'clawmini-lite.js subagents spawn --id tail-sub --delivery notify "echo tail-content"',
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

  it('delegations list from a subagent returns only its own children, not peers or parents', async () => {
    await env.addChat('nested-list-chat', 'debug-agent');
    chat = await env.connect('nested-list-chat');

    // Parent spawns outer-sub. outer-sub itself spawns inner-sub (its child)
    // and then calls `delegations list --json`. From outer-sub's perspective,
    // only inner-sub should appear (parentId === outer-sub).
    await env.sendMessage(
      'clawmini-lite.js subagents spawn --id outer-sub --delivery notify "clawmini-lite.js subagents spawn --id inner-sub --delivery notify \\"echo inner-done\\" && sleep 3 && clawmini-lite.js delegations list --state completed --json"',
      { chat: 'nested-list-chat', agent: 'debug-agent' }
    );

    // outer-sub's own command log (subagentId=outer-sub) must contain the
    // JSON output of its own `list` call, showing inner-sub. We poll the
    // on-disk delegation record path + the chat buffer because the
    // command-message stream sometimes lands slightly after the
    // subscription-event we'd otherwise hook into.
    let outerLog: CommandLogMessage | undefined;
    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline) {
      outerLog = chat.messageBuffer.find(
        (m): m is CommandLogMessage =>
          m.role === 'command' &&
          !!(m as CommandLogMessage).subagentId &&
          (m as CommandLogMessage).stdout.includes('"id": "inner-sub"')
      );
      if (outerLog) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(outerLog).toBeDefined();
    expect(outerLog!.stdout).toContain('"id": "inner-sub"');
    // outer-sub is its own parent, not its own child — must not appear in
    // its own list output.
    expect(outerLog!.stdout).not.toMatch(/"id":\s*"outer-sub"/);

    // Parent's view: list must include outer-sub (direct child) but not
    // inner-sub (grandchild — parentId=outer-sub, not undefined). We do not
    // restrict by --state so the snapshot includes outer-sub whether it has
    // settled or is still running (it briefly stays 'running' while it
    // processes the inner-sub completion notification turn).
    await env.sendMessage('clawmini-lite.js delegations list --kind subagent --json', {
      chat: 'nested-list-chat',
      agent: 'debug-agent',
    });
    let parentLog: CommandLogMessage | undefined;
    const parentDeadline = Date.now() + 30_000;
    while (Date.now() < parentDeadline) {
      parentLog = chat.messageBuffer.find(
        (m): m is CommandLogMessage =>
          m.role === 'command' &&
          !(m as CommandLogMessage).subagentId &&
          (m as CommandLogMessage).stdout.includes('delegations list --kind subagent --json:') &&
          (m as CommandLogMessage).stdout.includes('"id": "outer-sub"')
      );
      if (parentLog) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(parentLog).toBeDefined();
    expect(parentLog!.stdout).toContain('"id": "outer-sub"');
    expect(parentLog!.stdout).not.toMatch(/"id":\s*"inner-sub"/);
  }, 60000);

  it('depth-1 default --delivery is manual; explicit notify + tail surfaces the inner output', async () => {
    await env.addChat('sync-chat', 'debug-agent');
    chat = await env.connect('sync-chat');

    // Ticket 7 (§3.3): depth ≥ 1 default is now `manual`. The new pattern is
    // explicit observation via `delegations wait` / `subagents tail`, not
    // implicit sync-wait. Here the outer subagent spawns sync-inner with
    // `--delivery notify` so it runs in the background, then `delegations
    // wait` blocks until completion and `subagents tail` extracts the inner
    // echo so the test can confirm the result threaded back to sync-outer's
    // stdout.
    await env.sendMessage(
      'clawmini-lite.js subagents spawn --id sync-outer --delivery notify "clawmini-lite.js subagents spawn --id sync-inner --delivery notify \\"echo sync-value\\" && clawmini-lite.js delegations wait sync-inner && clawmini-lite.js subagents tail sync-inner"',
      { chat: 'sync-chat', agent: 'debug-agent' }
    );

    // sync-outer's stdout (subagentId=sync-outer) should contain the inner's
    // echo value (the tail's [AGENT] line).
    const outerLog = await chat.waitForMessage(
      commandMatching(
        (m) =>
          !!m.subagentId &&
          m.stdout.includes('sync-value') &&
          m.stdout.includes('"state": "completed"')
      ),
      30000
    );
    expect(outerLog).toBeDefined();
  }, 30000);

  it('delegations wait called before subagent finishes blocks until completion', async () => {
    await env.addChat('wait-before-chat', 'debug-agent');
    chat = await env.connect('wait-before-chat');

    // Chain spawn && wait in the same shell so `wait` is called while the
    // subagent is still sleeping. This exercises the event-iterator path
    // of delegationWait (not the synchronous early-return hit by the
    // `wait returns the completed subagent record` test above).
    await env.sendMessage(
      'clawmini-lite.js subagents spawn --id wait-before-sub --delivery notify "sleep 3 && echo slow-done" && clawmini-lite.js delegations wait wait-before-sub',
      { chat: 'wait-before-chat', agent: 'debug-agent' }
    );

    // The parent's wrapped stdout contains the JSON wait result — when the
    // wait blocks until completion, the resolved array will include the id
    // and the completed state.
    const waitLog = await chat.waitForMessage(
      commandMatching(
        (m) =>
          !m.subagentId &&
          m.stdout.includes('"id": "wait-before-sub"') &&
          m.stdout.includes('"state": "completed"')
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
      'clawmini-lite.js subagents spawn --id notify-busy-sub --delivery notify "echo notify-done-early" && sleep 2 && echo parent-still-working',
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
      'clawmini-lite.js subagents spawn --id notify-idle-sub --delivery notify "sleep 2 && echo late-done"',
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

  it('delegations wait <a> <b> --all waits until both subagents resolve', async () => {
    await env.addChat('two-wait-chat', 'debug-agent');
    chat = await env.connect('two-wait-chat');

    // Spawn two async subagents, then wait on both with --all. The wait
    // call prints `{resolved: [...], pending: []}` JSON containing both ids.
    await env.sendMessage(
      'clawmini-lite.js subagents spawn --id two-a --delivery notify "echo both-output-a" && clawmini-lite.js subagents spawn --id two-b --delivery notify "echo both-output-b" && clawmini-lite.js delegations wait two-a two-b --all',
      { chat: 'two-wait-chat', agent: 'debug-agent' }
    );

    const log = await chat.waitForMessage(
      commandMatching(
        (m) =>
          !m.subagentId &&
          m.stdout.includes('"id": "two-a"') &&
          m.stdout.includes('"id": "two-b"') &&
          m.stdout.includes('"state": "completed"')
      ),
      20000
    );
    expect(log.exitCode).toBe(0);
  }, 30000);

  it('delegations list --state running --kind subagent from a subagent returns only active children', async () => {
    await env.addChat('blocking-sub-chat', 'debug-agent');
    chat = await env.connect('blocking-sub-chat');

    // Outer subagent spawns two children: one instant (will be completed),
    // one sleeping (will still be active). `delegations list --state running
    // --kind subagent` from outer must return ONLY block-active, not
    // block-done.
    await env.sendMessage(
      [
        'clawmini-lite.js subagents spawn --id block-outer --delivery notify',
        '"clawmini-lite.js subagents spawn --id block-done --delivery notify \\"echo done-fast\\"',
        '&& clawmini-lite.js subagents spawn --id block-active --delivery notify \\"sleep 3 && echo late\\"',
        '&& sleep 1',
        '&& clawmini-lite.js delegations list --state running --kind subagent --json"',
      ].join(' '),
      { chat: 'blocking-sub-chat', agent: 'debug-agent' }
    );

    const outerLog = await chat.waitForMessage(
      commandMatching(
        (m) => m.subagentId === 'block-outer' && m.stdout.includes('"id": "block-active"')
      ),
      20000
    );
    expect(outerLog.stdout).toContain('"id": "block-active"');
    expect(outerLog.stdout).not.toMatch(/"id":\s*"block-done"/);
  }, 30000);

  it('spawn without --id auto-generates a 3-char alphanum id that the CLI reports back', async () => {
    await env.addChat('auto-id-chat', 'debug-agent');
    chat = await env.connect('auto-id-chat');

    await env.sendMessage('clawmini-lite.js subagents spawn --delivery notify "echo auto-id-output"', {
      chat: 'auto-id-chat',
      agent: 'debug-agent',
    });

    // Post-Ticket-3: ids are 3-char (or longer on collision) lowercase
    // alphanum, generated by DelegationStore.generateId. Matcher must
    // accept growth past 3 chars in case of (extremely rare) collisions.
    const announce = await chat.waitForMessage(
      commandMatching(
        (m) =>
          !m.subagentId && /Subagent spawned successfully with ID: [0-9a-z]{3,}\b/.test(m.stdout)
      )
    );
    const match = announce.stdout.match(/Subagent spawned successfully with ID: ([0-9a-z]{3,})\b/);
    expect(match).not.toBeNull();
    const generatedId = match![1]!;

    // Wait for the subagent's own output to land, then verify the on-disk
    // delegation record matches the announced id.
    await chat.waitForMessage(
      commandMatching((m) => m.subagentId === generatedId && m.stdout.includes('auto-id-output'))
    );
    const rec = env.readDelegation('auto-id-chat', generatedId) as {
      id?: string;
      kind?: string;
    } | null;
    expect(rec?.id).toBe(generatedId);
    expect(rec?.kind).toBe('subagent');
  }, 30000);

  it('spawn --agent <other> routes the subagent through a different agent', async () => {
    await env.addChat('alt-agent-chat', 'debug-agent');
    chat = await env.connect('alt-agent-chat');

    // Define a second agent whose template prefixes output with [ALT] so
    // we can verify the spawn actually routed through it rather than
    // inheriting the parent's debug-agent.
    await env.addAgent('alt-agent');
    env.writeAgentSettings('alt-agent', {
      commands: {
        new: 'echo "[ALT] $CLAW_CLI_MESSAGE:" && eval "$CLAW_CLI_MESSAGE"',
        append: 'echo "[ALT] $CLAW_CLI_MESSAGE:" && eval "$CLAW_CLI_MESSAGE"',
        getSessionId: 'node -e "console.log(Math.random().toString(36).slice(2, 10))"',
      },
    });
    // Ticket 4 (§4): cross-agent spawns now require an approval rule. This
    // test exercises routing, not approvals, so we open the edge with a
    // `*` rule. The approval semantics themselves are covered by
    // `subagent-approval.test.ts`.
    const policiesPath = env.getClawminiPath('policies.json');
    const fs = await import('node:fs');
    fs.writeFileSync(
      policiesPath,
      JSON.stringify({
        policies: {},
        subagents: [{ from: '*', to: '*', autoApprove: true }],
      })
    );

    await env.sendMessage(
      'clawmini-lite.js subagents spawn --id alt-sub --agent alt-agent --delivery notify "echo alt-output"',
      { chat: 'alt-agent-chat', agent: 'debug-agent' }
    );

    // The subagent's command_log should show the [ALT] prefix, proving
    // alt-agent's template ran rather than debug-agent's [DEBUG] one.
    const subLog = await chat.waitForMessage(
      commandMatching(
        (m) => m.subagentId === 'alt-sub' && m.stdout.includes('[ALT] echo alt-output:')
      )
    );
    expect(subLog.stdout).toContain('alt-output');
    expect(subLog.stdout).not.toContain('[DEBUG]');

    const rec = env.readDelegation('alt-agent-chat', 'alt-sub') as {
      targetAgentId?: string;
    } | null;
    expect(rec?.targetAgentId).toBe('alt-agent');
  }, 30000);

  it('spawn with a duplicate --id is rejected', async () => {
    await env.addChat('dup-id-chat', 'debug-agent');
    chat = await env.connect('dup-id-chat');

    await env.sendMessage('clawmini-lite.js subagents spawn --id dup-sub --delivery notify "echo first"', {
      chat: 'dup-id-chat',
      agent: 'debug-agent',
    });
    await chat.waitForMessage(
      commandMatching((m) => m.subagentId === 'dup-sub' && m.stdout.includes('first'))
    );

    // Second spawn with the same id must hit the router's duplicate-id
    // guard (`Subagent ID already exists`). The CLI surfaces the TRPC
    // error via stderr + exit 1, so we match on the serialized message.
    await env.sendMessage('clawmini-lite.js subagents spawn --id dup-sub --delivery notify "echo second"', {
      chat: 'dup-id-chat',
      agent: 'debug-agent',
    });
    await chat.waitForMessage(
      (m) => JSON.stringify(m).includes('Subagent ID already exists'),
      15000
    );

    // The duplicate spawn must not have overwritten the first: there's
    // still exactly one 'first'-producing subagent and no 'second' output.
    expect(
      chat.messageBuffer.some(
        (m) =>
          (m as { subagentId?: string }).subagentId === 'dup-sub' &&
          typeof (m as { stdout?: string }).stdout === 'string' &&
          (m as { stdout?: string }).stdout!.includes('second')
      )
    ).toBe(false);
  }, 30000);

  it('send without --delivery flag from root agent blocks the caller and returns <subagent_output>', async () => {
    await env.addChat('send-sync-chat', 'debug-agent');
    chat = await env.connect('send-sync-chat');

    // Spawn a child and let it complete first so the second `send` is
    // exercising the wake-a-completed-child path, not the initial spawn.
    await env.sendMessage(
      'clawmini-lite.js subagents spawn --id send-sync-sub --delivery notify "echo sync-initial"',
      { chat: 'send-sync-chat', agent: 'debug-agent' }
    );
    await chat.waitForMessage(
      commandMatching((m) => m.subagentId === 'send-sync-sub' && m.stdout.includes('sync-initial'))
    );

    // `send` with no explicit --delivery flag: the CLI sync-waits on
    // delegationWait and prints the subagent's agent-role output wrapped
    // in <subagent_output> tags.
    await env.sendMessage(
      "clawmini-lite.js subagents send send-sync-sub -p 'echo sync-send-output'",
      { chat: 'send-sync-chat', agent: 'debug-agent' }
    );
    const log = await chat.waitForMessage(
      commandMatching(
        (m) =>
          !m.subagentId &&
          m.stdout.includes('<subagent_output>') &&
          m.stdout.includes('sync-send-output')
      ),
      20000
    );
    expect(log.stdout).toContain('</subagent_output>');
  }, 30000);

  it('send wakes a completed child, flipping status active → completed', async () => {
    await env.addChat('send-wake-chat', 'debug-agent');
    chat = await env.connect('send-wake-chat');

    await env.sendMessage('clawmini-lite.js subagents spawn --id wake-sub --delivery notify "echo initial"', {
      chat: 'send-wake-chat',
      agent: 'debug-agent',
    });
    await chat.waitForMessage(
      commandMatching((m) => m.subagentId === 'wake-sub' && m.stdout.includes('initial'))
    );
    // Child is now completed — confirm before sending.
    for (let i = 0; i < 50; i++) {
      const rec = env.readDelegation('send-wake-chat', 'wake-sub');
      if (rec && (rec.state as string) === 'completed') break;
      await new Promise((r) => setTimeout(r, 100));
    }

    await env.sendMessage("clawmini-lite.js subagents send wake-sub --delivery notify -p 'echo after-wake'", {
      chat: 'send-wake-chat',
      agent: 'debug-agent',
    });

    // The child's command_log should contain the wake-up output (runs via
    // `append`, so it has the `[DEBUG <sessionId>]` prefix).
    const followUp = await chat.waitForMessage(
      commandMatching((m) => m.subagentId === 'wake-sub' && m.stdout.includes('after-wake'))
    );
    expect(followUp.stdout).toMatch(/\[DEBUG [^\]]+\] echo after-wake:/);

    // And the delegation eventually settles back on completed.
    let state: string | undefined;
    for (let i = 0; i < 50; i++) {
      const rec = env.readDelegation('send-wake-chat', 'wake-sub');
      state = rec ? (rec.state as string) : undefined;
      if (state === 'completed') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(state).toBe('completed');
  }, 30000);

  it('send queues a second message while the child is still running', async () => {
    await env.addChat('send-queue-chat', 'debug-agent');
    chat = await env.connect('send-queue-chat');

    // Start a slow initial command so the follow-up `send` lands while
    // the first turn is still in flight. The task scheduler keys queues
    // by `rootChatId:sessionId`, so the second handleMessage call must
    // wait for the first before running.
    await env.sendMessage(
      'clawmini-lite.js subagents spawn --id queue-sub --delivery notify "sleep 2 && echo queued-first"',
      { chat: 'send-queue-chat', agent: 'debug-agent' }
    );
    // Wait for active, then immediately send the follow-up.
    for (let i = 0; i < 50; i++) {
      const rec = env.readDelegation('send-queue-chat', 'queue-sub');
      if (rec && (rec.state as string) === 'running') break;
      await new Promise((r) => setTimeout(r, 100));
    }

    await env.sendMessage(
      "clawmini-lite.js subagents send queue-sub --delivery notify -p 'echo queued-second'",
      { chat: 'send-queue-chat', agent: 'debug-agent' }
    );

    // Both outputs must land, and the first must come before the second.
    await chat.waitForMessage(
      commandMatching((m) => m.subagentId === 'queue-sub' && m.stdout.includes('queued-first')),
      20000
    );
    await chat.waitForMessage(
      commandMatching((m) => m.subagentId === 'queue-sub' && m.stdout.includes('queued-second')),
      20000
    );
    const firstIdx = chat.messageBuffer.findIndex(
      (m) =>
        (m as { subagentId?: string; stdout?: string }).subagentId === 'queue-sub' &&
        typeof (m as { stdout?: string }).stdout === 'string' &&
        (m as { stdout?: string }).stdout!.includes('queued-first')
    );
    const secondIdx = chat.messageBuffer.findIndex(
      (m) =>
        (m as { subagentId?: string; stdout?: string }).subagentId === 'queue-sub' &&
        typeof (m as { stdout?: string }).stdout === 'string' &&
        (m as { stdout?: string }).stdout!.includes('queued-second')
    );
    expect(firstIdx).toBeGreaterThanOrEqual(0);
    expect(secondIdx).toBeGreaterThan(firstIdx);
  }, 40000);

  it('async completion notification wakes the parent agent to run a new turn', async () => {
    await env.addChat('wake-parent-chat', 'debug-agent');
    chat = await env.connect('wake-parent-chat');

    // The parent's shell command is just the spawn — it returns immediately
    // after the subagent is registered. When the subagent finishes later,
    // executeSubagent injects `<notification>Subagent … completed.</notification>`
    // as a new message into the parent's session, which causes the parent's
    // debug-agent command to RUN against that notification content. The
    // result is a fresh command_log (no subagentId) with the [DEBUG …]
    // prefix wrapping the notification text.
    await env.sendMessage(
      'clawmini-lite.js subagents spawn --id wake-parent-sub --delivery notify "echo wake-content"',
      { chat: 'wake-parent-chat', agent: 'debug-agent' }
    );
    await chat.waitForMessage(
      commandMatching(
        (m) => m.subagentId === 'wake-parent-sub' && m.stdout.includes('wake-content')
      )
    );

    // A command_log with no subagentId and the [DEBUG …] prefix wrapping
    // `<notification>` text is the proof the parent actually ran — the raw
    // system message alone would not carry that prefix.
    const wakeLog = await chat.waitForMessage(
      commandMatching(
        (m) =>
          !m.subagentId &&
          /\[DEBUG[^\]]*\] <notification>Subagent wake-parent-sub completed/.test(m.stdout)
      ),
      15000
    );
    expect(wakeLog.stdout).toContain('wake-parent-sub completed');
  }, 30000);

  it('operations on a nonexistent subagent id return NOT_FOUND', async () => {
    await env.addChat('missing-id-chat', 'debug-agent');
    chat = await env.connect('missing-id-chat');

    // Each of these CLI calls should hit the router and fail with a
    // NOT_FOUND error surfaced back to the caller's stderr.
    const ops: Array<{ cmd: string; expect: RegExp }> = [
      { cmd: 'clawmini-lite.js subagents stop ghost', expect: /Subagent not found/ },
      { cmd: 'clawmini-lite.js subagents tail ghost --json', expect: /Subagent not found/ },
      {
        cmd: "clawmini-lite.js subagents send ghost --delivery notify -p 'echo x'",
        expect: /Subagent not found/,
      },
      { cmd: 'clawmini-lite.js delegations delete ghost', expect: /Delegation not found/ },
      { cmd: 'clawmini-lite.js delegations show ghost', expect: /Delegation not found/ },
    ];
    for (const op of ops) {
      await env.sendMessage(op.cmd, { chat: 'missing-id-chat', agent: 'debug-agent' });
      const log = await chat.waitForMessage(
        commandMatching((m) => !m.subagentId && m.stdout.includes(`${op.cmd}:`)),
        15000
      );
      expect(JSON.stringify(log)).toMatch(op.expect);
    }
  }, 60000);
});
