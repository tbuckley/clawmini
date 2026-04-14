import { spawn, execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

export function createE2EContext(dirName: string) {
  const binPath = path.resolve(__dirname, '../../dist/cli/index.mjs');
  const e2eDir = path.join(os.homedir(), '.gemini', 'tmp', `clawmini-${dirName}`);

  function runCli(
    args: string[]
  ): Promise<{ stdout: string; stderr: string; code: number | null }> {
    const isInit = args[0] === 'init';
    return new Promise((resolve) => {
      const child = spawn('node', [binPath, ...args], {
        cwd: e2eDir,
        env: { ...process.env },
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (isInit && code === 0) {
          // Update settings to set API port to 0, assigning a random available port
          const settingsPath = path.resolve(e2eDir, '.clawmini/settings.json');
          if (fs.existsSync(settingsPath)) {
            try {
              const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
              settings.api = { port: 0 }; // Use random available port to avoid EADDRINUSE during parallel e2e tests
              fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
            } catch {
              // ignore
            }
          }
        }
        resolve({ stdout, stderr, code });
      });
    });
  }

  async function setupE2E() {
    if (fs.existsSync(e2eDir)) {
      fs.rmSync(e2eDir, { recursive: true, force: true });
    }
    fs.mkdirSync(e2eDir, { recursive: true });
    execSync('git init', { cwd: e2eDir, stdio: 'ignore' });
  }

  async function teardownE2E() {
    await runCli(['down']);

    if (fs.existsSync(e2eDir)) {
      fs.rmSync(e2eDir, { recursive: true, force: true });
    }
  }

  return { runCli, e2eDir, binPath, setupE2E, teardownE2E };
}

export async function setupSubagentEnv(
  runCli: (args: string[]) => Promise<{ stdout: string; stderr: string; code: number | null }>,
  e2eDir: string,
  options: { port?: number; routers?: unknown[]; policies?: unknown } = {}
) {
  await runCli(['init']);
  await runCli(['agents', 'add', 'debug-agent', '--template', 'debug']);

  const settingsPath = path.resolve(e2eDir, '.clawmini/settings.json');
  let originalSettings = '{}';
  if (fs.existsSync(settingsPath)) {
    originalSettings = fs.readFileSync(settingsPath, 'utf8');
  }
  const settings = JSON.parse(originalSettings);
  if (options.routers) settings.routers = options.routers;
  if (options.port) settings.api = { ...settings.api, host: '127.0.0.1', port: options.port };
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

  if (options.policies) {
    fs.writeFileSync(
      path.resolve(e2eDir, '.clawmini/policies.json'),
      JSON.stringify({ policies: options.policies }, null, 2)
    );
  }

  await runCli(['up']);

  const litePath = path.resolve(e2eDir, 'clawmini-lite.js');
  await runCli(['export-lite', '--out', litePath]);
  fs.chmodSync(litePath, '755');

  const binDir = path.resolve(e2eDir, 'bin');
  fs.mkdirSync(binDir);
  fs.symlinkSync(litePath, path.join(binDir, 'clawmini-lite.js'));

  const agentSettingsPath = path.resolve(e2eDir, '.clawmini/agents/debug-agent/settings.json');
  const agentSettings = JSON.parse(fs.readFileSync(agentSettingsPath, 'utf8'));
  agentSettings.env = agentSettings.env || {};
  agentSettings.env.PATH = `${binDir}:${process.env.PATH}`;
  fs.writeFileSync(agentSettingsPath, JSON.stringify(agentSettings, null, 2));
}

export async function waitForMessage(
  e2eDir: string,
  chatId: string,
  predicate: (msg: Record<string, unknown>) => boolean,
  options = { retries: 40, interval: 250 }
) {
  const logPath = path.resolve(e2eDir, `.clawmini/chats/${chatId}/chat.jsonl`);
  for (let i = 0; i < options.retries; i++) {
    if (fs.existsSync(logPath)) {
      const chatLog = fs.readFileSync(logPath, 'utf8');
      const messages = chatLog
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l));
      const match = messages.find(predicate);
      if (match) return match;
    }
    await new Promise((r) => setTimeout(r, options.interval));
  }
  return null;
}

export async function waitForLogMatch(
  e2eDir: string,
  chatId: string,
  regex: RegExp,
  options = { retries: 40, interval: 250 }
) {
  const logPath = path.resolve(e2eDir, `.clawmini/chats/${chatId}/chat.jsonl`);
  for (let i = 0; i < options.retries; i++) {
    if (fs.existsSync(logPath)) {
      const log = fs.readFileSync(logPath, 'utf8');
      const match = log.match(regex);
      if (match) return match;
    }
    await new Promise((r) => setTimeout(r, options.interval));
  }
  return null;
}
