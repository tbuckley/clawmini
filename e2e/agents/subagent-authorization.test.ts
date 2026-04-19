import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import {
  TestEnvironment,
  type ChatSubscription,
  commandMatching,
} from '../_helpers/test-environment.js';

// Verifies the subagent router only lets a caller act on its own direct
// children — peers, grandchildren, and parents are off-limits. The router
// enforces `sub.parentId === ctx.tokenPayload.subagentId` on every mutation
// and query; these tests probe each endpoint via the lite CLI.

const FORBIDDEN_PATTERN = /not a child of the caller|Subagent not found/i;

describe('E2E Subagent Authorization', () => {
  let env: TestEnvironment;

  beforeAll(async () => {
    env = new TestEnvironment('e2e-subagent-authz');
    await env.setup();
    await env.setupSubagentEnv();
  }, 30000);

  afterAll(() => env.teardown(), 30000);
  afterEach(() => env.disconnectAll());

  async function spawnSibling(
    chatId: string,
    chat: ChatSubscription,
    id: string,
    body: string
  ): Promise<void> {
    await env.sendMessage(`clawmini-lite.js subagents spawn --id ${id} --async "${body}"`, {
      chat: chatId,
      agent: 'debug-agent',
    });
    await chat.waitForMessage(
      commandMatching((m) => m.subagentId === id && m.stdout.length > 0)
    );
  }

  // Runs `body` inside a newly-spawned subagent `attackerId` whose parent is
  // the root agent, and waits for `body`'s output to land in that subagent's
  // command log. Used to exercise "sibling attacks peer" scenarios — the
  // attacker's CLI call runs with its own token, so the router sees it as a
  // peer of any other top-level subagent.
  async function runAttack(
    chatId: string,
    chat: ChatSubscription,
    attackerId: string,
    body: string
  ): Promise<string> {
    await env.sendMessage(
      `clawmini-lite.js subagents spawn --id ${attackerId} --async "${body}"`,
      { chat: chatId, agent: 'debug-agent' }
    );
    // Wait for ANY command log from the attacker — we inspect it after.
    const log = await chat.waitForMessage(
      commandMatching(
        (m) => m.subagentId === attackerId && (m.stdout.length > 0 || !!m.stderr)
      ),
      15000
    );
    return JSON.stringify(log);
  }

  it('peer subagent cannot tail a sibling', async () => {
    const chatId = 'authz-tail';
    await env.addChat(chatId, 'debug-agent');
    const chat = await env.connect(chatId);

    await spawnSibling(chatId, chat, 'authz-tail-victim', 'echo victim-secret');

    const serialized = await runAttack(
      chatId,
      chat,
      'authz-tail-attacker',
      'clawmini-lite.js subagents tail authz-tail-victim --json'
    );

    expect(serialized).toMatch(FORBIDDEN_PATTERN);
    expect(serialized).not.toContain('victim-secret');
  }, 30000);

  it('peer subagent cannot wait on a sibling', async () => {
    const chatId = 'authz-wait';
    await env.addChat(chatId, 'debug-agent');
    const chat = await env.connect(chatId);

    await spawnSibling(chatId, chat, 'authz-wait-victim', 'echo wait-victim');

    const serialized = await runAttack(
      chatId,
      chat,
      'authz-wait-attacker',
      'clawmini-lite.js subagents wait authz-wait-victim'
    );

    expect(serialized).toMatch(FORBIDDEN_PATTERN);
  }, 30000);

  it('peer subagent cannot send to a sibling', async () => {
    const chatId = 'authz-send';
    await env.addChat(chatId, 'debug-agent');
    const chat = await env.connect(chatId);

    await spawnSibling(chatId, chat, 'authz-send-victim', 'echo send-victim');

    const serialized = await runAttack(
      chatId,
      chat,
      'authz-send-attacker',
      "clawmini-lite.js subagents send authz-send-victim --async -p 'echo injected'"
    );

    expect(serialized).toMatch(FORBIDDEN_PATTERN);
    // Victim must not have received the injected prompt.
    const victimLogs = chat.messageBuffer.filter(
      (m) => (m as { subagentId?: string }).subagentId === 'authz-send-victim'
    );
    expect(JSON.stringify(victimLogs)).not.toContain('injected');
  }, 30000);

  it('peer subagent cannot stop a sibling', async () => {
    const chatId = 'authz-stop';
    await env.addChat(chatId, 'debug-agent');
    const chat = await env.connect(chatId);

    // Long-running victim so an unauthorized stop would be observable via
    // tracker state.
    await env.sendMessage(
      'clawmini-lite.js subagents spawn --id authz-stop-victim --async "sleep 5 && echo victim-survived"',
      { chat: chatId, agent: 'debug-agent' }
    );
    for (let i = 0; i < 50; i++) {
      const settings = env.getChatSettings(chatId) as {
        subagents?: Record<string, { status: string }>;
      };
      if (settings.subagents?.['authz-stop-victim']?.status === 'active') break;
      await new Promise((r) => setTimeout(r, 100));
    }

    const serialized = await runAttack(
      chatId,
      chat,
      'authz-stop-attacker',
      'clawmini-lite.js subagents stop authz-stop-victim'
    );

    expect(serialized).toMatch(FORBIDDEN_PATTERN);
    // Victim's status must not have flipped to 'failed' from the stop attempt.
    const settings = env.getChatSettings(chatId) as {
      subagents?: Record<string, { status: string }>;
    };
    expect(settings.subagents?.['authz-stop-victim']?.status).toBe('active');
  }, 30000);

  it('peer subagent cannot delete a sibling', async () => {
    const chatId = 'authz-delete';
    await env.addChat(chatId, 'debug-agent');
    const chat = await env.connect(chatId);

    await spawnSibling(chatId, chat, 'authz-delete-victim', 'echo delete-victim');

    const serialized = await runAttack(
      chatId,
      chat,
      'authz-delete-attacker',
      'clawmini-lite.js subagents delete authz-delete-victim'
    );

    expect(serialized).toMatch(FORBIDDEN_PATTERN);
    // Victim tracker must still exist.
    const settings = env.getChatSettings(chatId) as {
      subagents?: Record<string, unknown>;
    };
    expect(settings.subagents?.['authz-delete-victim']).toBeTruthy();
  }, 30000);

  it('parent cannot reach a grandchild via tail/wait/send/stop/delete', async () => {
    // Grandchildren belong to a subagent, not the root, so the root's token
    // (subagentId=undefined) should not satisfy parentId === undefined for
    // those records (their parentId is the intermediate subagent).
    const chatId = 'authz-gchild';
    await env.addChat(chatId, 'debug-agent');
    const chat = await env.connect(chatId);

    // Outer spawns inner and stays alive long enough for us to observe state.
    await env.sendMessage(
      'clawmini-lite.js subagents spawn --id authz-outer --async "clawmini-lite.js subagents spawn --id authz-inner --async \\"echo inner-done\\" && sleep 2"',
      { chat: chatId, agent: 'debug-agent' }
    );
    // Wait for inner to land in settings.
    for (let i = 0; i < 80; i++) {
      const s = env.getChatSettings(chatId) as {
        subagents?: Record<string, { parentId?: string }>;
      };
      if (s.subagents?.['authz-inner']?.parentId === 'authz-outer') break;
      await new Promise((r) => setTimeout(r, 100));
    }

    // From the root agent's chat, each op on authz-inner must fail.
    const attacks = [
      'clawmini-lite.js subagents tail authz-inner --json',
      'clawmini-lite.js subagents wait authz-inner',
      "clawmini-lite.js subagents send authz-inner --async -p 'echo x'",
      'clawmini-lite.js subagents stop authz-inner',
      'clawmini-lite.js subagents delete authz-inner',
    ];
    for (const attack of attacks) {
      await env.sendMessage(attack, { chat: chatId, agent: 'debug-agent' });
      const log = await chat.waitForMessage(
        commandMatching(
          (m) => !m.subagentId && m.stdout.includes(`${attack}:`) && !!m.stderr
        ),
        15000
      );
      expect(JSON.stringify(log)).toMatch(FORBIDDEN_PATTERN);
    }
  }, 45000);

  it('subagent CAN access its own child (positive control)', async () => {
    // Make sure the authz enforcement isn't over-broad: a subagent that
    // spawns its own child must still be able to tail/wait/stop/delete it.
    const chatId = 'authz-positive';
    await env.addChat(chatId, 'debug-agent');
    const chat = await env.connect(chatId);

    // Outer spawns inner, then tails inner's log — inner.parentId === outer,
    // caller token.subagentId === outer, so access is allowed.
    await env.sendMessage(
      'clawmini-lite.js subagents spawn --id pos-outer --async "clawmini-lite.js subagents spawn --id pos-inner --async \\"echo inner-visible\\" && sleep 1 && clawmini-lite.js subagents tail pos-inner --json"',
      { chat: chatId, agent: 'debug-agent' }
    );

    const outerLog = await chat.waitForMessage(
      commandMatching(
        (m) => m.subagentId === 'pos-outer' && m.stdout.includes('inner-visible')
      ),
      20000
    );
    // Must NOT contain the forbidden error — the happy path has content, not
    // an error message.
    expect(outerLog.stdout).not.toMatch(/not a child of the caller/i);
  }, 30000);
});
