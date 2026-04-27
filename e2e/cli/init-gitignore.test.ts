import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { TestEnvironment } from '../_helpers/test-environment.js';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const TEMPLATE_PATH = path.join(REPO_ROOT, 'docs', 'backups', 'clawmini.gitignore');

// (path relative to .clawmini/, expected to be ignored by the allow-list)
const cases: Array<[string, boolean]> = [
  // Safe — must NOT be ignored
  ['settings.json', false],
  ['policies.json', false],
  ['policy-scripts/run-host.js', false],
  ['commands/foo.md', false],
  ['templates/my-agent/settings.json', false],
  ['chats/default/settings.json', false],
  ['agents/bob/settings.json', false],
  ['agents/bob/installed-files.json', false],
  ['environments/macos/env.json', false],
  ['adapters/discord/state.json', false],

  // Sensitive — MUST be ignored
  ['chats/default/chat.jsonl', true],
  ['adapters/discord/config.json', true],
  ['adapters/google-chat/config.json', true],
  ['adapters/google-chat/state.json', true],
  ['agents/bob/sessions/abc/settings.json', true],
  ['agents/bob/tmp/stdout-x.txt', true],
  ['daemon.log', true],
  ['daemon.sock', true],
  ['supervisor.pid', true],
  ['logs/web.log', true],
  ['tmp/requests/r.json', true],
  ['tmp/snapshots/x.txt', true],
  ['settings.json.1234.deadbeef.tmp', true],
];

describe('clawmini init installs backup .gitignore', () => {
  let env: TestEnvironment;
  let clawminiDir: string;

  beforeAll(async () => {
    env = new TestEnvironment('e2e-tmp-init-gitignore');
    await env.setup();

    const { code, stdout } = await env.init();
    expect(code).toBe(0);
    expect(stdout).toContain('Initialized .clawmini/.gitignore');

    clawminiDir = env.getClawminiPath();
    execFileSync('git', ['init', '--quiet'], { cwd: clawminiDir });
  }, 30000);

  afterAll(() => env.teardown(), 30000);

  it('writes .clawmini/.gitignore matching the docs template', () => {
    const installed = fs.readFileSync(env.getClawminiPath('.gitignore'), 'utf8');
    const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
    expect(installed).toBe(template);
  });

  for (const [relPath, expectIgnored] of cases) {
    it(`${expectIgnored ? 'ignores' : 'tracks'} ${relPath}`, () => {
      // Materialize the file so git's directory-traversal rules see it the
      // same way they would in a real workspace. (Allow-list `.gitignore`
      // patterns can otherwise behave differently for non-existent paths.)
      const fullPath = path.join(clawminiDir, relPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      if (!fs.existsSync(fullPath)) fs.writeFileSync(fullPath, '');

      const result = spawnSync('git', ['check-ignore', '-q', '--', relPath], {
        cwd: clawminiDir,
      });

      // git check-ignore exit codes:
      //   0 = path is ignored
      //   1 = path is NOT ignored
      // Anything else is an error.
      expect([0, 1]).toContain(result.status);
      const actuallyIgnored = result.status === 0;
      expect(actuallyIgnored).toBe(expectIgnored);
    });
  }
});
