import { spawn, execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

export class TestEnvironment {
  public e2eDir: string;
  public binPath: string;
  public id: string;

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

  public async setup() {
    if (fs.existsSync(this.e2eDir)) {
      fs.rmSync(this.e2eDir, { recursive: true, force: true });
    }
    fs.mkdirSync(this.e2eDir, { recursive: true });
    execSync('git init', { cwd: this.e2eDir, stdio: 'ignore' });
  }

  public async teardown() {
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
    return this.runCli(['chats', 'add', id, '--agent', agentName]);
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
