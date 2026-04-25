import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import fs from 'node:fs';
import {
  TestEnvironment,
  type ChatSubscription,
  type ChatMessage,
} from '../_helpers/test-environment.js';

// Router replies surface as `system` messages with `displayRole: 'agent'`,
// produced by `logAutomaticReply` in chat-logger.ts.
function routerReplyContaining(text: string) {
  return (m: ChatMessage): boolean =>
    m.role === 'system' && typeof m.content === 'string' && m.content.includes(text);
}

describe('/model Router E2E', () => {
  let env: TestEnvironment;
  let chat: ChatSubscription | undefined;

  beforeAll(async () => {
    env = new TestEnvironment('e2e-slash-model');
    await env.setup();
    await env.runCli(['init', '--agent', 'test-agent', '--agent-template', 'debug']);
    await env.up();
    await env.addChat('model-chat', 'test-agent');
  }, 30000);

  afterAll(() => env.teardown(), 30000);
  afterEach(() => env.disconnectAll());

  // Reset the overlay between tests so state from one test doesn't leak
  // into the next. The daemon reads the overlay fresh on each /model call,
  // so a direct file write is safe.
  beforeEach(() => {
    env.writeAgentSettings('test-agent', { extends: 'debug' });
  });

  it('lists current model and shorthands on bare /model', async () => {
    env.writeAgentSettings('test-agent', {
      extends: 'debug',
      env: { MODEL: 'gemini-3-pro' },
      modelShorthands: { flash: 'gemini-3-flash-preview', pro: 'gemini-3-pro' },
    });

    chat = await env.connect('model-chat');
    await env.sendMessage('/model', { chat: 'model-chat' });

    const msg = await chat.waitForMessage(routerReplyContaining('Current model: gemini-3-pro'));
    expect(msg.content).toContain('- flash -> gemini-3-flash-preview');
    expect(msg.content).toContain('- pro -> gemini-3-pro');
  }, 15000);

  it('sets env.MODEL to a literal model name and persists to overlay', async () => {
    chat = await env.connect('model-chat');
    await env.sendMessage('/model claude-opus-4-7', { chat: 'model-chat' });

    await chat.waitForMessage(routerReplyContaining('Set MODEL to claude-opus-4-7'));

    const overlay = env.getAgentSettings('test-agent') as { env?: { MODEL?: string } };
    expect(overlay.env?.MODEL).toBe('claude-opus-4-7');
  }, 15000);

  it('resolves a shorthand and writes the full name to overlay', async () => {
    env.writeAgentSettings('test-agent', {
      extends: 'debug',
      modelShorthands: { flash: 'gemini-3-flash-preview' },
    });

    chat = await env.connect('model-chat');
    await env.sendMessage('/model flash', { chat: 'model-chat' });

    const msg = await chat.waitForMessage(
      routerReplyContaining('Set MODEL to gemini-3-flash-preview')
    );
    expect(msg.content).toContain("shorthand 'flash'");

    const overlay = env.getAgentSettings('test-agent') as { env?: { MODEL?: string } };
    expect(overlay.env?.MODEL).toBe('gemini-3-flash-preview');
  }, 15000);

  it('round-trips /model add then /model <shorthand>', async () => {
    chat = await env.connect('model-chat');

    await env.sendMessage('/model add lite gemini-3.1-flash-lite', { chat: 'model-chat' });
    await chat.waitForMessage(
      routerReplyContaining('Added shorthand: lite -> gemini-3.1-flash-lite')
    );

    const afterAdd = env.getAgentSettings('test-agent') as {
      modelShorthands?: Record<string, string>;
    };
    expect(afterAdd.modelShorthands).toEqual({ lite: 'gemini-3.1-flash-lite' });

    await env.sendMessage('/model lite', { chat: 'model-chat' });
    await chat.waitForMessage(routerReplyContaining('Set MODEL to gemini-3.1-flash-lite'));

    const afterUse = env.getAgentSettings('test-agent') as {
      env?: { MODEL?: string };
      modelShorthands?: Record<string, string>;
    };
    expect(afterUse.env?.MODEL).toBe('gemini-3.1-flash-lite');
    expect(afterUse.modelShorthands).toEqual({ lite: 'gemini-3.1-flash-lite' });
  }, 20000);

  it('removes a shorthand from the overlay', async () => {
    env.writeAgentSettings('test-agent', {
      extends: 'debug',
      modelShorthands: { flash: 'gemini-3-flash-preview', lite: 'gemini-3.1-flash-lite' },
    });

    chat = await env.connect('model-chat');
    await env.sendMessage('/model rm flash', { chat: 'model-chat' });
    await chat.waitForMessage(routerReplyContaining('Removed shorthand: flash'));

    const overlay = env.getAgentSettings('test-agent') as {
      modelShorthands?: Record<string, string>;
    };
    expect(overlay.modelShorthands).toEqual({ lite: 'gemini-3.1-flash-lite' });
  }, 15000);

  // Regression: `/model add foo gemini-3 pro` previously stored the literal
  // multi-token value `gemini-3 pro` as MODEL. Now rejects with usage.
  it('rejects /model add when the full name has whitespace', async () => {
    chat = await env.connect('model-chat');
    await env.sendMessage('/model add foo gemini-3 pro', { chat: 'model-chat' });

    await chat.waitForMessage(routerReplyContaining('Usage: /model add <shorthand> <full-name>'));

    const overlay = env.getAgentSettings('test-agent') as {
      modelShorthands?: Record<string, string>;
      env?: { MODEL?: string };
    };
    expect(overlay.modelShorthands).toBeUndefined();
    expect(overlay.env?.MODEL).toBeUndefined();
  }, 15000);

  // Regression: `/model X` against an agent without an overlay used to
  // silently fabricate a stub `{env: {MODEL: X}}` settings file with no
  // `extends`, breaking subsequent agent resolution. Now it refuses.
  it('refuses to write when the agent has no settings overlay', async () => {
    const settingsPath = env.getAgentPath('test-agent', 'settings.json');
    fs.rmSync(settingsPath);
    expect(fs.existsSync(settingsPath)).toBe(false);

    chat = await env.connect('model-chat');
    await env.sendMessage('/model gemini-3-pro', { chat: 'model-chat' });

    await chat.waitForMessage(routerReplyContaining('has no settings overlay'));

    expect(fs.existsSync(settingsPath)).toBe(false);
  }, 15000);
});
