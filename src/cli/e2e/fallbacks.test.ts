import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { createE2EContext } from './utils.js';

const { runCli, e2eDir, setupE2E, teardownE2E } = createE2EContext('e2e-tmp-fallbacks');

describe('E2E Fallbacks Tests', () => {
  beforeAll(async () => {
    await setupE2E();
    await runCli(['init']);
  }, 30000);

  afterAll(teardownE2E, 30000);

  it('should fallback when base agent fails with exit code', async () => {
    const settingsPath = path.resolve(e2eDir, '.clawmini/settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));

    settings.defaultAgent = {
      commands: {
        new: 'if [ "$SUCCESS" = "true" ]; then echo "Succeeded"; else echo "Failed" >&2; exit 1; fi',
      },
      fallbacks: [
        {
          env: { SUCCESS: 'true' },
          retries: 0,
          delayMs: 100,
        },
      ],
    };
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

    await runCli(['chats', 'add', 'fb-chat-1']);
    await runCli(['messages', 'send', 'test-1', '--chat', 'fb-chat-1']);
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const chatLogPath = path.resolve(e2eDir, '.clawmini/chats/fb-chat-1/chat.jsonl');
    const chatLog = fs.readFileSync(chatLogPath, 'utf8');
    const lines = chatLog
      .trim()
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l));

    // Lines: USER, LOG (retry-delay), LOG (success)
    expect(lines.some((l) => l.role === 'command' && l.content.includes('retrying'))).toBe(true);
    const commandLogs = lines.filter((l) => l.role === 'command');
    const lastLog = commandLogs[commandLogs.length - 1];
    expect(lastLog.role).toBe('command');
    expect(lastLog.content.trim()).toBe('Succeeded');
    expect(lastLog.exitCode).toBe(0);
  });

  it('should fallback when base agent returns empty content', async () => {
    const settingsPath = path.resolve(e2eDir, '.clawmini/settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));

    settings.defaultAgent = {
      commands: {
        new: 'echo "Base output"',
        getMessageContent: 'echo ""', // Empty content
      },
      fallbacks: [
        {
          commands: {
            getMessageContent: 'echo "Fallback success"',
          },
          retries: 0,
          delayMs: 100,
        },
      ],
    };
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

    await runCli(['chats', 'add', 'fb-chat-2']);
    await runCli(['messages', 'send', 'test-2', '--chat', 'fb-chat-2']);
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const chatLogPath = path.resolve(e2eDir, '.clawmini/chats/fb-chat-2/chat.jsonl');
    const chatLog = fs.readFileSync(chatLogPath, 'utf8');
    const lines = chatLog
      .trim()
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l));

    const lastLog = lines[lines.length - 1];
    expect(lastLog.content.trim()).toBe('Fallback success');
  });

  it('should support multiple retries with exponential backoff logs', async () => {
    const settingsPath = path.resolve(e2eDir, '.clawmini/settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));

    // Use a file to track attempts
    const attemptFile = path.resolve(e2eDir, 'attempts.txt');
    fs.writeFileSync(attemptFile, '0');

    settings.defaultAgent = {
      commands: {
        new: `
          attempts=$(cat ${attemptFile})
          attempts=$((attempts + 1))
          echo $attempts > ${attemptFile}
          if [ $attempts -lt 3 ]; then
            exit 1
          else
            echo "Third time is a charm"
          fi
        `,
      },
      fallbacks: [
        {
          retries: 2,
          delayMs: 100,
        },
      ],
    };
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

    await runCli(['chats', 'add', 'fb-chat-3']);
    await runCli(['messages', 'send', 'test-3', '--chat', 'fb-chat-3']);
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const chatLogPath = path.resolve(e2eDir, '.clawmini/chats/fb-chat-3/chat.jsonl');
    const chatLog = fs.readFileSync(chatLogPath, 'utf8');
    const lines = chatLog
      .trim()
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l));

    expect(
      lines.filter((l) => l.role === 'command' && l.content.includes('retrying')).length
    ).toBeGreaterThanOrEqual(1);
    expect(lines[lines.length - 1].content.trim()).toBe('Third time is a charm');
  }, 10000);

  it('should report final failure when all fallbacks are exhausted', async () => {
    const settingsPath = path.resolve(e2eDir, '.clawmini/settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));

    settings.defaultAgent = {
      commands: {
        new: 'exit 1',
      },
      fallbacks: [
        {
          commands: { new: 'echo "Fallback 1 fail" && exit 1' },
          retries: 0,
          delayMs: 100,
        },
      ],
    };
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

    await runCli(['chats', 'add', 'fb-chat-4']);
    await runCli(['messages', 'send', 'test-4', '--chat', 'fb-chat-4']);
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const chatLogPath = path.resolve(e2eDir, '.clawmini/chats/fb-chat-4/chat.jsonl');
    const chatLog = fs.readFileSync(chatLogPath, 'utf8');
    const lines = chatLog
      .trim()
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l));

    const commandLogs = lines.filter((l) => l.role === 'command');
    const lastLog = commandLogs[commandLogs.length - 1];
    expect(lastLog.exitCode).toBe(1);
    expect(lastLog.stdout.trim()).toBe('Fallback 1 fail');
  });
});
