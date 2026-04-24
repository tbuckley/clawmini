import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { TestEnvironment } from '../_helpers/test-environment.js';

describe('E2E Auto-update: lite refresh on `up`', () => {
  let env: TestEnvironment;

  beforeEach(async () => {
    env = new TestEnvironment('e2e-auto-update-lite');
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
