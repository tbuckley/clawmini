import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { createE2EContext } from './utils.js';

const { runCli, e2eDir, setupE2E, teardownE2E } = createE2EContext('e2e-export-lite');

describe('E2E Export Lite Tests', () => {
  beforeAll(setupE2E, 30000);
  afterAll(teardownE2E, 30000);

  it('should export clawmini-lite script to current directory', async () => {
    // Current directory context in runCli is e2eDir
    const { stdout, code } = await runCli(['export-lite']);
    expect(code).toBe(0);
    expect(stdout).toContain('Successfully exported clawmini-lite to');

    const expectedPath = path.join(e2eDir, 'clawmini-lite.js');
    expect(fs.existsSync(expectedPath)).toBe(true);

    const content = fs.readFileSync(expectedPath, 'utf8');
    expect(content).toContain('clawmini-lite - A standalone client');
  });

  it('should export clawmini-lite script to stdout', async () => {
    const { stdout, code } = await runCli(['export-lite', '--stdout']);
    expect(code).toBe(0);
    expect(stdout).toContain('clawmini-lite - A standalone client');
    expect(stdout).not.toContain('Successfully exported clawmini-lite to');
  });

  it('should export clawmini-lite script to specified file path', async () => {
    const customPath = path.join(e2eDir, 'custom-lite.js');
    const { stdout, code } = await runCli(['export-lite', '--out', customPath]);
    expect(code).toBe(0);
    expect(stdout).toContain(`Successfully exported clawmini-lite to ${customPath}`);
    expect(fs.existsSync(customPath)).toBe(true);
  });

  it('should export clawmini-lite script to specified directory path', async () => {
    const customDir = path.join(e2eDir, 'custom-dir');
    fs.mkdirSync(customDir);

    const { stdout, code } = await runCli(['export-lite', '--out', customDir]);
    expect(code).toBe(0);

    const expectedPath = path.join(customDir, 'clawmini-lite.js');
    expect(stdout).toContain(`Successfully exported clawmini-lite to ${expectedPath}`);
    expect(fs.existsSync(expectedPath)).toBe(true);
  });
});
