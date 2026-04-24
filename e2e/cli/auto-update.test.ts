import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { TestEnvironment } from '../_helpers/test-environment.js';
import {
  readEnvironment,
  getEnvironmentSearchDirs,
  substituteLayeredEnvDir,
  readEnvironmentPoliciesForPath,
  writeSettings,
  getAgent,
  getAgentOverlay,
  writeAgentSettings,
} from '../../src/shared/workspace.js';

describe('E2E Auto-update: lite refresh on `up`', () => {
  let env: TestEnvironment;

  beforeEach(async () => {
    env = new TestEnvironment('e2e-au-lite');
    await env.setup();
    await env.init();
  }, 30000);

  afterEach(() => env.teardown(), 30000);

  async function enableMacos() {
    const { code } = await env.runCli(['environments', 'enable', 'macos']);
    expect(code).toBe(0);
  }

  it('up refreshes clawmini-lite.js for active environments', async () => {
    await enableMacos();
    const { code } = await env.up();
    expect(code).toBe(0);

    const litePath = path.join(env.e2eDir, '.local', 'bin', 'clawmini-lite.js');
    expect(fs.existsSync(litePath)).toBe(true);

    const content = fs.readFileSync(litePath, 'utf8');
    expect(content).toContain('clawmini-lite - A standalone client');
    expect(content.startsWith('#!')).toBe(true);
  });

  it('up skips lite write when content matches (no mtime touch)', async () => {
    await enableMacos();
    await env.up();
    const litePath = path.join(env.e2eDir, '.local', 'bin', 'clawmini-lite.js');
    const firstMtime = fs.statSync(litePath).mtimeMs;

    // Small wait to ensure mtime resolution could advance if we did rewrite
    await new Promise((r) => setTimeout(r, 50));

    await env.down();
    await env.up();
    const secondMtime = fs.statSync(litePath).mtimeMs;
    expect(secondMtime).toBe(firstMtime);
  });

  it('up refuses to overwrite a non-clawmini file at the export path', async () => {
    await enableMacos();
    const litePath = path.join(env.e2eDir, '.local', 'bin', 'clawmini-lite.js');
    fs.mkdirSync(path.dirname(litePath), { recursive: true });
    const sentinel = 'totally not a lite script\n';
    fs.writeFileSync(litePath, sentinel);

    const { stderr } = await env.up();
    expect(fs.readFileSync(litePath, 'utf8')).toBe(sentinel);
    expect(stderr).toContain('Refusing to overwrite');
  });

  it('environments enable still copies by default (no extends added)', async () => {
    const { code } = await env.runCli(['environments', 'enable', 'macos']);
    expect(code).toBe(0);
    const envJson = JSON.parse(
      fs.readFileSync(env.getClawminiPath('environments', 'macos', 'env.json'), 'utf8')
    );
    expect(envJson.extends).toBeUndefined();
    expect(envJson.prefix).toContain('sandbox-exec');
    expect(fs.existsSync(env.getClawminiPath('environments', 'macos', 'sandbox.sb'))).toBe(true);
  });

  it('up does not place a default lite shim when no environment is active', async () => {
    const { code } = await env.up();
    expect(code).toBe(0);

    // Nothing should place clawmini-lite.js anywhere outside .clawmini
    const walk = (dir: string): string[] => {
      const result: string[] = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === '.clawmini' || entry.name === '.git' || entry.name === 'node_modules') {
          continue;
        }
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          result.push(...walk(full));
        } else {
          result.push(full);
        }
      }
      return result;
    };
    const files = walk(env.e2eDir);
    const stray = files.filter((p) => path.basename(p) === 'clawmini-lite.js');
    expect(stray).toEqual([]);
  });
});

describe('E2E Auto-update: environment overlay (`extends`)', () => {
  let env: TestEnvironment;

  beforeEach(async () => {
    env = new TestEnvironment('e2e-au-env');
    await env.setup();
    await env.init();
  }, 30000);

  afterEach(() => env.teardown(), 30000);

  function writeOverlayEnv(name: string, data: Record<string, unknown>) {
    const overlayDir = env.getClawminiPath('environments', name);
    fs.mkdirSync(overlayDir, { recursive: true });
    fs.writeFileSync(path.join(overlayDir, 'env.json'), JSON.stringify(data, null, 2));
    return overlayDir;
  }

  it('environment with extends inherits built-in env.json fields', async () => {
    writeOverlayEnv('my-macos', {
      extends: 'macos',
      env: { MY_VAR: 'v' },
    });
    await writeSettings({ environments: { './': 'my-macos' } }, env.e2eDir);

    const resolved = await readEnvironment('my-macos', env.e2eDir);
    expect(resolved).toBeTruthy();
    // `prefix` and `exportLiteTo` from the built-in macos flow through.
    expect(resolved!.prefix).toContain('sandbox-exec');
    expect(resolved!.exportLiteTo).toBe('.local/bin/clawmini-lite.js');
    // `env` is deep-merged at one level — MY_VAR added without dropping PATH.
    expect(resolved!.env?.MY_VAR).toBe('v');
    expect(typeof resolved!.env?.PATH).toBe('string');
  });

  it('{ENV_DIR} resolution falls back to built-in for missing local files', async () => {
    const overlayDir = writeOverlayEnv('my-macos', { extends: 'macos' });
    await writeSettings({ environments: { './': 'my-macos' } }, env.e2eDir);

    const searchDirs = await getEnvironmentSearchDirs('my-macos', env.e2eDir);
    expect(searchDirs[0]).toBe(overlayDir);
    // The built-in macos template dir should come second.
    const builtinDir = searchDirs.find((d) => d.includes('templates/environments/macos'));
    expect(builtinDir).toBeTruthy();

    const resolved = substituteLayeredEnvDir('{ENV_DIR}/sandbox.sb', searchDirs);
    expect(resolved).toBe(path.join(builtinDir!, 'sandbox.sb'));

    // Dropping a local sandbox.sb makes the overlay win.
    fs.writeFileSync(path.join(overlayDir, 'sandbox.sb'), '; local\n');
    const resolvedLocal = substituteLayeredEnvDir('{ENV_DIR}/sandbox.sb', searchDirs);
    expect(resolvedLocal).toBe(path.join(overlayDir, 'sandbox.sb'));
  });

  it('layered resolution picks overlay policy script when it exists', async () => {
    const overlayDir = writeOverlayEnv('my-cladding', {
      extends: 'cladding',
      policies: {
        'allowlist-domain': { command: './allowlist-domain.mjs' },
      },
    });
    fs.writeFileSync(path.join(overlayDir, 'allowlist-domain.mjs'), '#!/usr/bin/env node\n');
    await writeSettings({ environments: { './': 'my-cladding' } }, env.e2eDir);

    const policies = await readEnvironmentPoliciesForPath('./', env.e2eDir);
    expect(policies['allowlist-domain']?.command).toBe(
      path.join(overlayDir, 'allowlist-domain.mjs')
    );
  });

  it('layered resolution falls back to built-in policy script', async () => {
    writeOverlayEnv('my-cladding', { extends: 'cladding' });
    await writeSettings({ environments: { './': 'my-cladding' } }, env.e2eDir);

    const policies = await readEnvironmentPoliciesForPath('./', env.e2eDir);
    const cmd = policies['allowlist-domain']?.command;
    expect(cmd).toBeTruthy();
    expect(cmd).toContain('templates/environments/cladding/allowlist-domain.mjs');
  });
});

describe('E2E Auto-update: agent overlay (`extends`)', () => {
  let env: TestEnvironment;

  beforeEach(async () => {
    env = new TestEnvironment('e2e-au-agent');
    await env.setup();
    await env.init();
  }, 30000);

  afterEach(() => env.teardown(), 30000);

  it('agents add --template writes overlay shape with extends', async () => {
    const { code } = await env.runCli(['agents', 'add', 'bob', '--template', 'gemini-claw']);
    expect(code).toBe(0);

    const overlay = env.getAgentSettings('bob');
    expect(overlay.extends).toBe('gemini-claw');
    // The overlay should not contain merged-in template fields like
    // `commands`, `apiTokenEnvVar`, etc.
    expect(overlay.commands).toBeUndefined();
    expect(overlay.apiTokenEnvVar).toBeUndefined();
  });

  it('getAgent merges template fields into local fields', async () => {
    await env.runCli(['agents', 'add', 'bob', '--template', 'gemini-claw']);
    const resolved = await getAgent('bob', env.e2eDir);
    expect(resolved).toBeTruthy();
    expect(resolved!.apiTokenEnvVar).toBe('GEMINI_CLI_CLAW_API_TOKEN');
    expect(resolved!.commands?.new).toContain('gemini');
    expect(resolved!.skillsDir).toBe('.gemini/skills/');
    expect(resolved!.fallbacks?.length).toBeGreaterThan(0);
  });

  it('local field overrides template field shallowly', async () => {
    await env.runCli(['agents', 'add', 'bob', '--template', 'gemini-claw']);
    const overlay = (await getAgentOverlay('bob', env.e2eDir)) || {};
    overlay.commands = { new: 'echo local-command' };
    await writeAgentSettings('bob', overlay, env.e2eDir);

    const resolved = await getAgent('bob', env.e2eDir);
    expect(resolved!.commands?.new).toBe('echo local-command');
    // Shallow override — template's `append` is also replaced.
    expect(resolved!.commands?.append).toBeUndefined();
  });

  it('env deep-merges one level', async () => {
    await env.runCli(['agents', 'add', 'bob', '--template', 'gemini-claw']);
    const overlay = (await getAgentOverlay('bob', env.e2eDir)) || {};
    overlay.env = { MODEL: 'gemini-custom' };
    await writeAgentSettings('bob', overlay, env.e2eDir);

    const resolved = await getAgent('bob', env.e2eDir);
    expect(resolved!.env?.MODEL).toBe('gemini-custom');
    // Template entries flow through (GEMINI_SYSTEM_MD, GEMINI_API_KEY).
    expect(resolved!.env?.GEMINI_SYSTEM_MD).toBe('true');
    expect(resolved!.env?.GEMINI_API_KEY).toBe(true);
  });

  it('agents add --fork copies everything and writes no extends', async () => {
    const { code } = await env.runCli([
      'agents',
      'add',
      'bob',
      '--template',
      'gemini-claw',
      '--fork',
    ]);
    expect(code).toBe(0);
    const overlay = env.getAgentSettings('bob');
    expect(overlay.extends).toBeUndefined();
    // Fork mode merges template fields into the local file.
    expect(overlay.apiTokenEnvVar).toBe('GEMINI_CLI_CLAW_API_TOKEN');
    expect(overlay.skillsDir).toBe('.gemini/skills/');
  });

  it('existing agent without extends is unchanged after up', async () => {
    // Legacy-shape agent written by hand (no extends).
    fs.mkdirSync(path.join(env.e2eDir, 'legacy'), { recursive: true });
    env.writeAgentSettings('legacy', {
      directory: './legacy',
      commands: { new: 'echo legacy' },
    });
    const before = JSON.stringify(env.getAgentSettings('legacy'));

    const { code } = await env.up();
    expect(code).toBe(0);
    const after = JSON.stringify(env.getAgentSettings('legacy'));
    expect(after).toBe(before);
  }, 30000);

  it('template.json and settings.json are not copied into the agent workdir', async () => {
    const { code } = await env.runCli(['agents', 'add', 'bob', '--template', 'gemini-claw']);
    expect(code).toBe(0);
    expect(fs.existsSync(path.join(env.e2eDir, 'bob', 'settings.json'))).toBe(false);
    expect(fs.existsSync(path.join(env.e2eDir, 'bob', 'template.json'))).toBe(false);
  });
});

describe('E2E Auto-update: template.json + SHA tracking', () => {
  let env: TestEnvironment;

  beforeEach(async () => {
    env = new TestEnvironment('e2e-au-sha');
    await env.setup();
    await env.init();
  }, 30000);

  afterEach(() => env.teardown(), 30000);

  it('new agent with --template records SHAs and creates installed-files.json', async () => {
    const { code } = await env.runCli(['agents', 'add', 'bob', '--template', 'gemini-claw']);
    expect(code).toBe(0);

    const installedPath = env.getAgentPath('bob', 'installed-files.json');
    expect(fs.existsSync(installedPath)).toBe(true);
    const installed = JSON.parse(fs.readFileSync(installedPath, 'utf8'));
    // Manifest declares GEMINI.md as track; an entry must exist.
    expect(installed.files['GEMINI.md']).toBeTruthy();
    expect(typeof installed.files['GEMINI.md'].sha).toBe('string');
    // Seed-once files are also recorded at first install.
    expect(installed.files['SOUL.md']).toBeTruthy();
  });

  it('recorded SHAs match the template content at create time', async () => {
    await env.runCli(['agents', 'add', 'bob', '--template', 'gemini-claw']);

    const installedPath = env.getAgentPath('bob', 'installed-files.json');
    const installed = JSON.parse(fs.readFileSync(installedPath, 'utf8'));

    const workspaceRoot = path.resolve(__dirname, '..', '..');
    const templateGemini = path.join(workspaceRoot, 'templates', 'gemini-claw', 'GEMINI.md');
    const templateContent = fs.readFileSync(templateGemini);
    const { createHash } = await import('node:crypto');
    const expected = createHash('sha256').update(templateContent).digest('hex');
    expect(installed.files['GEMINI.md'].sha).toBe(expected);
  });

  it('up does not copy template.json to the destination', async () => {
    await env.runCli(['agents', 'add', 'bob', '--template', 'gemini-claw']);
    expect(fs.existsSync(path.join(env.e2eDir, 'bob', 'template.json'))).toBe(false);
    const { code } = await env.up();
    expect(code).toBe(0);
    expect(fs.existsSync(path.join(env.e2eDir, 'bob', 'template.json'))).toBe(false);
  });

  it('directory entries in the manifest apply recursively', async () => {
    await env.runCli(['agents', 'add', 'bob', '--template', 'gemini-claw']);
    const installedPath = env.getAgentPath('bob', 'installed-files.json');
    const installed = JSON.parse(fs.readFileSync(installedPath, 'utf8'));
    // Everything under .gemini/ is 'track' per the manifest.
    const gemini = Object.keys(installed.files).filter((k) => k.startsWith('.gemini/'));
    expect(gemini.length).toBeGreaterThan(0);
  });
});
