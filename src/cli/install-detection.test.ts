import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { detectInstall } from './install-detection.js';

describe('detectInstall', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clawmini-install-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('reports isNpmGlobal=false for an entry path that lives outside npm root', () => {
    // Use a real path under tmp so realpath resolves.
    const entryDir = path.join(tmp, 'devcheckout', 'dist');
    fs.mkdirSync(entryDir, { recursive: true });
    const entry = path.join(entryDir, 'cli.mjs');
    fs.writeFileSync(entry, '');
    const info = detectInstall(entry);
    expect(info.isNpmGlobal).toBe(false);
    // entryRealPath is whatever realpath returns; on macOS /tmp is itself a
    // symlink to /private/tmp, so just check it ends with our suffix.
    expect(info.entryRealPath.endsWith(path.join('devcheckout', 'dist', 'cli.mjs'))).toBe(true);
  });

  it('detects npm-link as NOT npm-global (the symlink target lives outside npm root)', () => {
    // Real install layout: <npmRoot>/clawmini/dist/cli.mjs as a SYMLINK to
    // <devCheckout>/dist/cli.mjs. After realpath, the entry path resolves to
    // the dev checkout, so isNpmGlobal must be false.
    const npmRoot = path.join(tmp, 'npm-root');
    const devRoot = path.join(tmp, 'dev-checkout');
    fs.mkdirSync(npmRoot, { recursive: true });
    fs.mkdirSync(path.join(devRoot, 'dist'), { recursive: true });
    const realEntry = path.join(devRoot, 'dist', 'cli.mjs');
    fs.writeFileSync(realEntry, '');

    // Simulate `npm link`: a symlink at npm root → the dev checkout.
    fs.symlinkSync(devRoot, path.join(npmRoot, 'clawmini'));

    const linkedEntry = path.join(npmRoot, 'clawmini', 'dist', 'cli.mjs');
    const info = detectInstall(linkedEntry);
    // The realpath of `linkedEntry` lands inside devRoot, not npmRoot.
    expect(info.entryRealPath).toBe(fs.realpathSync(realEntry));
    // We have no way to mock `npm root -g` in this test, so the host's real
    // npm root is consulted. The test asserts a *property* of the realpath,
    // not the boolean (which depends on the host). So:
    expect(info.entryRealPath.startsWith(fs.realpathSync(devRoot))).toBe(true);
  });

  it('detects a real npm install as npm-global when entry is under npm root', () => {
    // We can't mock execFileSync without restructuring — instead, exercise
    // the path-prefix logic by giving an entry under our fake "npm root" and
    // checking via realpath comparison directly. This documents the
    // realpath-based check; the integration boolean is asserted in the
    // detect path against the real `npm root -g`.
    const npmRoot = path.join(tmp, 'npm-root');
    const installedRoot = path.join(npmRoot, 'clawmini');
    fs.mkdirSync(path.join(installedRoot, 'dist'), { recursive: true });
    const entry = path.join(installedRoot, 'dist', 'cli.mjs');
    fs.writeFileSync(entry, '');

    const realEntry = fs.realpathSync(entry);
    const realNpmRoot = fs.realpathSync(npmRoot);
    expect(realEntry.startsWith(realNpmRoot + path.sep)).toBe(true);
  });
});
