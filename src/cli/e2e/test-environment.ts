import { spawn, execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { createTRPCClient, httpLink, splitLink, httpSubscriptionLink } from '@trpc/client';
import type { UserRouter as AppRouter } from '../../daemon/api/index.js';
import { createUnixSocketFetch } from '../../shared/fetch.js';
import { createUnixSocketEventSource } from '../../shared/event-source.js';
import type { ChatMessage } from '../../daemon/chats.js';

export class TestEnvironment {
  public e2eDir: string;
  public binPath: string;
  public id: string;
  public trpcClient: ReturnType<typeof createTRPCClient<AppRouter>> | null = null;
  public messageBuffer: ChatMessage[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private subscription: any | null = null;

  constructor(prefix: string) {
    this.id = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    this.e2eDir = path.join(os.homedir(), '.gemini', 'tmp', `clawmini-${this.id}`);
    this.binPath = path.resolve(__dirname, '../../../dist/cli/index.mjs');
  }

  public runCli(args: string[]): Promise<{ stdout: string; stderr: string; code: number | null }> {
    const isInit = args[0] === 'init';
    return new Promise((resolve) => {
      const child = spawn('node', [this.binPath, ...args], {
        cwd: this.e2eDir,
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
          const settingsPath = path.resolve(this.e2eDir, '.clawmini/settings.json');
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

  public async connect(chatId: string = 'default-chat') {
    const socketPath = path.join(this.e2eDir, '.clawmini', 'daemon.sock');

    // Wait for socket to exist
    for (let i = 0; i < 50; i++) {
      if (fs.existsSync(socketPath)) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    if (!fs.existsSync(socketPath)) {
      throw new Error(`Daemon socket not found at ${socketPath}`);
    }

    const customFetch = createUnixSocketFetch(socketPath);
    const CustomEventSource = createUnixSocketEventSource(socketPath);

    this.trpcClient = createTRPCClient<AppRouter>({
      links: [
        splitLink({
          condition(op) {
            return op.type === 'subscription';
          },
          true: httpSubscriptionLink({
            url: 'http://localhost',
            EventSource: CustomEventSource as unknown as typeof EventSource,
          }),
          false: httpLink({
            url: 'http://localhost',
            fetch: customFetch,
          }),
        }),
      ],
    });

    this.subscription = this.trpcClient.waitForMessages.subscribe(
      { chatId },
      {
        onData: (messages) => {
          this.messageBuffer.push(...messages);
        },
        onError: (err) => {
          console.error('Subscription error:', err);
        },
      }
    );
  }

  public async disconnect() {
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }
    this.trpcClient = null;
  }

  public async waitForMessage(
    predicate: (msg: ChatMessage) => boolean,
    timeoutMs: number = 15000
  ): Promise<ChatMessage> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      const match = this.messageBuffer.find(predicate);
      if (match) return match;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`waitForMessage timed out after ${timeoutMs}ms`);
  }

  public async setup() {
    if (fs.existsSync(this.e2eDir)) {
      fs.rmSync(this.e2eDir, { recursive: true, force: true });
    }
    fs.mkdirSync(this.e2eDir, { recursive: true });
    execSync('git init', { cwd: this.e2eDir, stdio: 'ignore' });
  }

  public async teardown() {
    await this.disconnect();
    if (fs.existsSync(this.e2eDir)) {
      await this.runCli(['down']);
      if (fs.existsSync(this.e2eDir)) {
        fs.rmSync(this.e2eDir, { recursive: true, force: true });
      }
    }
  }

  public async init() {
    return this.runCli(['init']);
  }

  public async up() {
    return this.runCli(['up']);
  }

  public async down() {
    return this.runCli(['down']);
  }

  public async addAgent(name: string, options: { template?: string } = {}) {
    const args = ['agents', 'add', name];
    if (options.template) {
      args.push('--template', options.template);
    }
    return this.runCli(args);
  }

  public async addChat(id: string, agentName: string) {
    const result = await this.runCli(['chats', 'add', id]);
    // The `chats add` CLI does not accept an agent flag, so persist the
    // association directly to the chat's settings file.
    this.writeChatSettings(id, { defaultAgent: agentName });
    return result;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public writeChatSettings(chatId: string, settings: any) {
    const chatSettingsPath = path.resolve(this.e2eDir, `.clawmini/chats/${chatId}/settings.json`);
    const chatSettingsDir = path.dirname(chatSettingsPath);
    if (!fs.existsSync(chatSettingsDir)) {
      fs.mkdirSync(chatSettingsDir, { recursive: true });
    }
    fs.writeFileSync(chatSettingsPath, JSON.stringify(settings, null, 2));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public getSettings(): any {
    const settingsPath = path.resolve(this.e2eDir, '.clawmini/settings.json');
    if (fs.existsSync(settingsPath)) {
      return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    }
    return {};
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public writeSettings(settings: any) {
    const settingsPath = path.resolve(this.e2eDir, '.clawmini/settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public getAgentSettings(agentId: string): any {
    const agentSettingsPath = path.resolve(
      this.e2eDir,
      `.clawmini/agents/${agentId}/settings.json`
    );
    if (fs.existsSync(agentSettingsPath)) {
      return JSON.parse(fs.readFileSync(agentSettingsPath, 'utf8'));
    }
    return {};
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public writeAgentSettings(agentId: string, settings: any) {
    const agentSettingsPath = path.resolve(
      this.e2eDir,
      `.clawmini/agents/${agentId}/settings.json`
    );
    const agentSettingsDir = path.dirname(agentSettingsPath);
    if (!fs.existsSync(agentSettingsDir)) {
      fs.mkdirSync(agentSettingsDir, { recursive: true });
    }
    fs.writeFileSync(agentSettingsPath, JSON.stringify(settings, null, 2));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public getChatSettings(chatId: string): any {
    const chatSettingsPath = path.resolve(this.e2eDir, `.clawmini/chats/${chatId}/settings.json`);
    if (fs.existsSync(chatSettingsPath)) {
      return JSON.parse(fs.readFileSync(chatSettingsPath, 'utf8'));
    }
    return {};
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public getSessionSettings(agentId: string, sessionId: string): any {
    const sessionSettingsPath = path.resolve(
      this.e2eDir,
      `.clawmini/agents/${agentId}/sessions/${sessionId}/settings.json`
    );
    if (fs.existsSync(sessionSettingsPath)) {
      return JSON.parse(fs.readFileSync(sessionSettingsPath, 'utf8'));
    }
    return {};
  }

  public updateSettings(updates: Record<string, unknown>) {
    const settingsPath = path.resolve(this.e2eDir, '.clawmini/settings.json');
    let settings = {};
    if (fs.existsSync(settingsPath)) {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const merge = (target: any, source: any) => {
      for (const key of Object.keys(source)) {
        if (source[key] instanceof Object && !Array.isArray(source[key])) {
          Object.assign(source[key], merge(target[key] || {}, source[key]));
        }
      }
      Object.assign(target || {}, source);
      return target;
    };
    settings = merge(settings, updates);
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  }

  public writePolicies(policies: unknown) {
    const policiesPath = path.resolve(this.e2eDir, '.clawmini/policies.json');
    const policiesDir = path.dirname(policiesPath);
    if (!fs.existsSync(policiesDir)) {
      fs.mkdirSync(policiesDir, { recursive: true });
    }
    fs.writeFileSync(policiesPath, JSON.stringify({ policies }, null, 2));
  }

  public async setupSubagentEnv(
    options: { port?: number; routers?: unknown[]; policies?: unknown } = {}
  ) {
    await this.init();
    await this.addAgent('debug-agent', { template: 'debug' });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const settingsUpdates: any = {};
    if (options.routers) settingsUpdates.routers = options.routers;
    if (options.port) settingsUpdates.api = { host: '127.0.0.1', port: options.port };
    this.updateSettings(settingsUpdates);

    if (options.policies) {
      this.writePolicies(options.policies);
    }

    await this.up();

    const litePath = path.resolve(this.e2eDir, 'clawmini-lite.js');
    await this.runCli(['export-lite', '--out', litePath]);
    fs.chmodSync(litePath, '755');

    const binDir = path.resolve(this.e2eDir, 'bin');
    fs.mkdirSync(binDir);
    fs.symlinkSync(litePath, path.join(binDir, 'clawmini-lite.js'));

    const agentSettingsPath = path.resolve(
      this.e2eDir,
      '.clawmini/agents/debug-agent/settings.json'
    );
    if (fs.existsSync(agentSettingsPath)) {
      const agentSettings = JSON.parse(fs.readFileSync(agentSettingsPath, 'utf8'));
      agentSettings.env = agentSettings.env || {};
      agentSettings.env.PATH = `${binDir}:${process.env.PATH}`;
      fs.writeFileSync(agentSettingsPath, JSON.stringify(agentSettings, null, 2));
    }
  }
}
