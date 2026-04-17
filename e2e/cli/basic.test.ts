import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import { TestEnvironment } from '../_helpers/test-environment.js';

describe('E2E Basic Tests', () => {
  let env: TestEnvironment;

  beforeAll(async () => {
    env = new TestEnvironment('e2e-tmp-basic');
    await env.setup();
  }, 30000);

  afterAll(() => env.teardown(), 30000);

  it('should run init and initialize settings', async () => {
    const { stdout, code } = await env.init();

    expect(code).toBe(0);
    expect(stdout).toContain('Initialized .clawmini/settings.json');

    expect(fs.existsSync(env.getClawminiPath('settings.json'))).toBe(true);
  });

  it('should create, list, set-default and delete chats', async () => {
    const { stdout: stdoutAdd, code: codeAdd } = await env.runCli(['chats', 'add', 'test-chat']);
    expect(codeAdd).toBe(0);
    expect(stdoutAdd).toContain('Chat test-chat created successfully.');

    expect(fs.existsSync(env.getChatPath('test-chat', 'chat.jsonl'))).toBe(true);

    const { stdout: stdoutList1 } = await env.runCli(['chats', 'list']);
    expect(stdoutList1).toContain('- test-chat');

    const { stdout: stdoutSetDefault } = await env.runCli(['chats', 'set-default', 'test-chat']);
    expect(stdoutSetDefault).toContain('Default chat set to test-chat.');

    const { stdout: stdoutList2 } = await env.runCli(['chats', 'list']);
    expect(stdoutList2).toContain('- test-chat *');

    const { stdout: stdoutDelete } = await env.runCli(['chats', 'delete', 'test-chat']);
    expect(stdoutDelete).toContain('Chat test-chat deleted successfully.');
    expect(fs.existsSync(env.getChatPath('test-chat'))).toBe(false);
  }, 15000);
});
