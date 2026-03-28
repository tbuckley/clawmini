import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { createE2EContext } from './utils.js';

const { runCli, e2eDir, setupE2E, teardownE2E } = createE2EContext('e2e-tmp-basic');

describe('E2E Basic Tests', () => {
  beforeAll(setupE2E, 30000);
  afterAll(teardownE2E, 30000);

  it('should run init and initialize settings', async () => {
    const { stdout, code } = await runCli(['init']);

    expect(code).toBe(0);
    expect(stdout).toContain('Initialized .clawmini/settings.json');

    const clawminiDir = path.resolve(e2eDir, '.clawmini');
    expect(fs.existsSync(path.join(clawminiDir, 'settings.json'))).toBe(true);
  });

  it('should create, list, set-default and delete chats', async () => {
    const { stdout: stdoutAdd, code: codeAdd } = await runCli(['chats', 'add', 'test-chat']);
    expect(codeAdd).toBe(0);
    expect(stdoutAdd).toContain('Chat test-chat created successfully.');

    const chatsDir = path.resolve(e2eDir, '.clawmini/chats');
    expect(fs.existsSync(path.join(chatsDir, 'test-chat', 'chat.jsonl'))).toBe(true);

    const { stdout: stdoutList1 } = await runCli(['chats', 'list']);
    expect(stdoutList1).toContain('- test-chat');

    const { stdout: stdoutSetDefault } = await runCli(['chats', 'set-default', 'test-chat']);
    expect(stdoutSetDefault).toContain('Default chat set to test-chat.');

    const { stdout: stdoutList2 } = await runCli(['chats', 'list']);
    expect(stdoutList2).toContain('- test-chat *');

    const { stdout: stdoutDelete } = await runCli(['chats', 'delete', 'test-chat']);
    expect(stdoutDelete).toContain('Chat test-chat deleted successfully.');
    expect(fs.existsSync(path.join(chatsDir, 'test-chat'))).toBe(false);
  }, 15000);
});
