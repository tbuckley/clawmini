import { spawn, execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import { createTRPCClient, httpLink, splitLink, httpSubscriptionLink } from '@trpc/client';
import type { UserRouter as AppRouter } from '../../src/daemon/api/index.js';
import { createUnixSocketFetch } from '../../src/shared/fetch.js';
import { createUnixSocketEventSource } from '../../src/shared/event-source.js';
import type { ChatMessage, CommandLogMessage } from '../../src/daemon/chats.js';

export async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      if (!address || typeof address === 'string') {
        srv.close();
        reject(new Error('Failed to get free port'));
        return;
      }
      const port = address.port;
      srv.close(() => resolve(port));
    });
  });
}

export interface ChatSubscription {
  messageBuffer: ChatMessage[];
  waitForMessage<T extends ChatMessage>(
    predicate: (msg: ChatMessage) => msg is T,
    timeoutMs?: number
  ): Promise<T>;
  waitForMessage(predicate: (msg: ChatMessage) => boolean, timeoutMs?: number): Promise<ChatMessage>;
  disconnect(): Promise<void>;
}

export class TestEnvironment {
  public e2eDir: string;
  public binPath: string;
  public id: string;
  public trpcClient: ReturnType<typeof createTRPCClient<AppRouter>> | null = null;
  private openSubscriptions: Set<ChatSubscription> = new Set();
  private credentials: { url: string; token: string } | null = null;

  constructor(prefix: string) {
    this.id = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    this.e2eDir = path.join(os.homedir(), '.gemini', 'tmp', `clawmini-${this.id}`);
    this.binPath = path.resolve(__dirname, '../../dist/cli/index.mjs');
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

  public async connect(chatId: string = 'default'): Promise<ChatSubscription> {
    await this.ensureTrpcClient();

    const messageBuffer: ChatMessage[] = [];
    const sub = this.trpcClient!.waitForMessages.subscribe(
      { chatId },
      {
        onData: (messages) => {
          messageBuffer.push(...messages);
        },
        onError: (err) => {
          console.error('Subscription error:', err);
        },
      }
    );

    const handle: ChatSubscription = {
      messageBuffer,
      waitForMessage: (
        predicate: (msg: ChatMessage) => boolean,
        timeoutMs: number = 15000
      ): Promise<ChatMessage> => {
        return (async () => {
          const startTime = Date.now();
          while (Date.now() - startTime < timeoutMs) {
            const match = messageBuffer.find(predicate);
            if (match) return match;
            await new Promise((r) => setTimeout(r, 100));
          }
          throw new Error(`waitForMessage timed out after ${timeoutMs}ms`);
        })();
      },
      disconnect: async () => {
        sub.unsubscribe();
        this.openSubscriptions.delete(handle);
      },
    };

    this.openSubscriptions.add(handle);
    return handle;
  }

  private async ensureTrpcClient() {
    if (this.trpcClient) return;

    const socketPath = path.join(this.e2eDir, '.clawmini', 'daemon.sock');
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
  }

  public async setup() {
    if (fs.existsSync(this.e2eDir)) {
      fs.rmSync(this.e2eDir, { recursive: true, force: true });
    }
    fs.mkdirSync(this.e2eDir, { recursive: true });
    execSync('git init', { cwd: this.e2eDir, stdio: 'ignore' });
  }

  public async teardown() {
    for (const sub of [...this.openSubscriptions]) {
      await sub.disconnect();
    }
    this.trpcClient = null;
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

  public async sendMessage(
    content: string,
    opts: { chat?: string; agent?: string; file?: string; noWait?: boolean } = {}
  ) {
    const args = ['messages', 'send', content];
    if (opts.chat) args.push('--chat', opts.chat);
    if (opts.agent) args.push('--agent', opts.agent);
    if (opts.file) args.push('--file', opts.file);
    if (opts.noWait) args.push('--no-wait');
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

  // Extracts CLAW_API_URL/CLAW_API_TOKEN from a debug-agent session. Requires
  // setupSubagentEnv() to have run (debug-agent + running daemon + exported
  // lite). Result is cached for the lifetime of the TestEnvironment.
  public async getAgentCredentials(): Promise<{ url: string; token: string }> {
    if (this.credentials) return this.credentials;

    const chatId = '__creds__';
    await this.runCli(['chats', 'add', chatId]);
    const chat = await this.connect(chatId);
    try {
      await this.sendMessage('echo "URL=$CLAW_API_URL" && echo "TOKEN=$CLAW_API_TOKEN"', {
        chat: chatId,
        agent: 'debug-agent',
      });
      const log = await chat.waitForMessage((m): m is CommandLogMessage => m.role === 'command');
      // Match start-of-line to skip the debug template's own [DEBUG] ... echo
      // line, which contains the literal text "URL=$CLAW_API_URL".
      const url = log.stdout.match(/^URL=(.+)$/m)![1]!.trim();
      const token = log.stdout.match(/^TOKEN=(.+)$/m)![1]!.trim();
      this.credentials = { url, token };
      return this.credentials;
    } finally {
      await chat.disconnect();
    }
  }

  // Spawns the exported clawmini-lite.js with CLAW_API_URL/CLAW_API_TOKEN
  // populated from the debug-agent. Fetches credentials lazily on first call.
  public async runLite(
    args: string[],
    opts: { cwd?: string; env?: Record<string, string> } = {}
  ): Promise<{ stdout: string; stderr: string; code: number | null }> {
    const { url, token } = await this.getAgentCredentials();
    const litePath = path.resolve(this.e2eDir, 'clawmini-lite.js');
    return new Promise((resolve) => {
      const p = spawn('node', [litePath, ...args], {
        env: {
          ...process.env,
          CLAW_API_URL: url,
          CLAW_API_TOKEN: token,
          ...opts.env,
        },
        cwd: opts.cwd ?? this.e2eDir,
      });
      let stdout = '';
      let stderr = '';
      p.stdout.on('data', (d) => (stdout += d.toString()));
      p.stderr.on('data', (d) => (stderr += d.toString()));
      p.on('close', (code) => resolve({ stdout, stderr, code }));
    });
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

    // Lite-based subagents need a real reachable HTTP port. init() stores
    // port: 0 for daemon socket tests, but that produces CLAW_API_URL=
    // http://127.0.0.1:0 which is unreachable. Pick a free port instead.
    const port = options.port ?? (await findFreePort());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const settingsUpdates: any = { api: { host: '127.0.0.1', port } };
    if (options.routers) settingsUpdates.routers = options.routers;
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
