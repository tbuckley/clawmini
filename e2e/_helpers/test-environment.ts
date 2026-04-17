/* eslint-disable max-lines */
import { spawn, execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import { createTRPCClient, httpLink, splitLink, httpSubscriptionLink } from '@trpc/client';
import type { UserRouter as AppRouter } from '../../src/daemon/api/index.js';
import { createUnixSocketFetch } from '../../src/shared/fetch.js';
import { createUnixSocketEventSource } from '../../src/shared/event-source.js';
import type {
  ChatMessage,
  CommandLogMessage,
  AgentReplyMessage,
  PolicyRequestMessage,
  SystemMessage,
  ToolMessage,
} from '../../src/daemon/chats.js';

export type {
  ChatMessage,
  CommandLogMessage,
  AgentReplyMessage,
  PolicyRequestMessage,
  SystemMessage,
  ToolMessage,
};

export function commandWith(
  text: string
): (msg: ChatMessage) => msg is CommandLogMessage {
  return (msg): msg is CommandLogMessage =>
    msg.role === 'command' && msg.stdout.includes(text);
}

export function commandMatching(
  predicate: (msg: CommandLogMessage) => boolean
): (msg: ChatMessage) => msg is CommandLogMessage {
  return (msg): msg is CommandLogMessage => msg.role === 'command' && predicate(msg);
}

export function agentReply(): (msg: ChatMessage) => msg is AgentReplyMessage {
  return (msg): msg is AgentReplyMessage => msg.role === 'agent';
}

export function agentReplyWith(
  text: string
): (msg: ChatMessage) => msg is AgentReplyMessage {
  return (msg): msg is AgentReplyMessage =>
    msg.role === 'agent' && msg.content === text;
}

export function policyWith(
  status?: PolicyRequestMessage['status']
): (msg: ChatMessage) => msg is PolicyRequestMessage {
  return (msg): msg is PolicyRequestMessage =>
    msg.role === 'policy' && (status === undefined || (msg as PolicyRequestMessage).status === status);
}

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

  public getClawminiPath(...parts: string[]): string {
    return path.resolve(this.e2eDir, '.clawmini', ...parts);
  }

  public getChatPath(chatId: string, ...parts: string[]): string {
    return this.getClawminiPath('chats', chatId, ...parts);
  }

  public getAgentPath(agentId: string, ...parts: string[]): string {
    return this.getClawminiPath('agents', agentId, ...parts);
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
          const settingsPath = this.getClawminiPath('settings.json');
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
    type Waiter = {
      predicate: (msg: ChatMessage) => boolean;
      resolve: (value: ChatMessage | PromiseLike<ChatMessage>) => void;
    };
    const waiters: Waiter[] = [];

    const sub = this.trpcClient!.waitForMessages.subscribe(
      { chatId },
      {
        onData: (messages) => {
          for (const msg of messages) {
            messageBuffer.push(msg);
            for (let i = waiters.length - 1; i >= 0; i--) {
              const waiter = waiters[i]!;
              if (waiter.predicate(msg)) {
                waiter.resolve(msg);
                waiters.splice(i, 1);
              }
            }
          }
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
        const existing = messageBuffer.find(predicate);
        if (existing) return Promise.resolve(existing);

        return new Promise<ChatMessage>((resolve, reject) => {
          const waiter = { predicate, resolve };
          waiters.push(waiter);

          const timer = setTimeout(() => {
            const idx = waiters.indexOf(waiter);
            if (idx !== -1) {
              waiters.splice(idx, 1);
              reject(new Error(`waitForMessage timed out after ${timeoutMs}ms`));
            }
          }, timeoutMs);

          const origResolve = waiter.resolve;
          waiter.resolve = (value) => {
            clearTimeout(timer);
            origResolve(value);
          };
        });
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

    const socketPath = this.getClawminiPath('daemon.sock');
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

  public async disconnectAll() {
    for (const sub of [...this.openSubscriptions]) {
      await sub.disconnect();
    }
  }

  public async teardown() {
    await this.disconnectAll();
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

  public async addChat(id: string, agentName?: string) {
    const result = await this.runCli(['chats', 'add', id]);
    if (agentName) {
      this.writeChatSettings(id, { defaultAgent: agentName });
    }
    return result;
  }

  public writeChatSettings(chatId: string, settings: Record<string, unknown>) {
    const chatSettingsPath = this.getChatPath(chatId, 'settings.json');
    const chatSettingsDir = path.dirname(chatSettingsPath);
    if (!fs.existsSync(chatSettingsDir)) {
      fs.mkdirSync(chatSettingsDir, { recursive: true });
    }
    fs.writeFileSync(chatSettingsPath, JSON.stringify(settings, null, 2));
  }

  public getSettings(): Record<string, unknown> {
    const settingsPath = this.getClawminiPath('settings.json');
    if (fs.existsSync(settingsPath)) {
      return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    }
    return {};
  }

  public writeSettings(settings: Record<string, unknown>) {
    const settingsPath = this.getClawminiPath('settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  }

  public getAgentSettings(agentId: string): Record<string, unknown> {
    const agentSettingsPath = this.getAgentPath(agentId, 'settings.json');
    if (fs.existsSync(agentSettingsPath)) {
      return JSON.parse(fs.readFileSync(agentSettingsPath, 'utf8'));
    }
    return {};
  }

  public writeAgentSettings(agentId: string, settings: Record<string, unknown>) {
    const agentSettingsPath = this.getAgentPath(agentId, 'settings.json');
    const agentSettingsDir = path.dirname(agentSettingsPath);
    if (!fs.existsSync(agentSettingsDir)) {
      fs.mkdirSync(agentSettingsDir, { recursive: true });
    }
    fs.writeFileSync(agentSettingsPath, JSON.stringify(settings, null, 2));
  }

  public updateAgentSettings(agentId: string, updates: Record<string, unknown>) {
    const settings = this.getAgentSettings(agentId);
    this.writeAgentSettings(agentId, deepMerge(settings, updates));
  }

  public getChatSettings(chatId: string): Record<string, unknown> {
    const chatSettingsPath = this.getChatPath(chatId, 'settings.json');
    if (fs.existsSync(chatSettingsPath)) {
      return JSON.parse(fs.readFileSync(chatSettingsPath, 'utf8'));
    }
    return {};
  }

  public getSessionSettings(agentId: string, sessionId: string): Record<string, unknown> {
    const sessionSettingsPath = this.getAgentPath(
      agentId,
      'sessions',
      sessionId,
      'settings.json'
    );
    if (fs.existsSync(sessionSettingsPath)) {
      return JSON.parse(fs.readFileSync(sessionSettingsPath, 'utf8'));
    }
    return {};
  }

  public updateSettings(updates: Record<string, unknown>) {
    const settingsPath = this.getClawminiPath('settings.json');
    let settings: Record<string, unknown> = {};
    if (fs.existsSync(settingsPath)) {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    }
    settings = deepMerge(settings, updates);
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
    const policiesPath = this.getClawminiPath('policies.json');
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
    const settingsUpdates: Record<string, unknown> = { api: { host: '127.0.0.1', port } };
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

    if (fs.existsSync(this.getAgentPath('debug-agent', 'settings.json'))) {
      this.updateAgentSettings('debug-agent', {
        env: { PATH: `${binDir}:${process.env.PATH}` },
      });
    }
  }

  public runBin(
    binPath: string,
    args: string[]
  ): Promise<{ stdout: string; stderr: string; code: number | null }> {
    return new Promise((resolve) => {
      const child = spawn('node', [binPath, ...args], {
        cwd: this.e2eDir,
        env: { ...process.env },
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data: Buffer) => (stdout += data.toString()));
      child.stderr.on('data', (data: Buffer) => (stderr += data.toString()));

      child.on('close', (code) => {
        resolve({ stdout, stderr, code });
      });
    });
  }
}

function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>
): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = result[key];
    if (
      srcVal !== null &&
      typeof srcVal === 'object' &&
      !Array.isArray(srcVal) &&
      tgtVal !== null &&
      typeof tgtVal === 'object' &&
      !Array.isArray(tgtVal)
    ) {
      result[key] = deepMerge(
        tgtVal as Record<string, unknown>,
        srcVal as Record<string, unknown>
      );
    } else {
      result[key] = srcVal;
    }
  }
  return result;
}
