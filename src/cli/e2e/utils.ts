import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

export function createE2EContext(dirName: string) {
  const binPath = path.resolve(__dirname, '../../../dist/cli/index.mjs');
  const e2eDir = path.resolve(__dirname, `../../../${dirName}`);

  function runCli(
    args: string[]
  ): Promise<{ stdout: string; stderr: string; code: number | null }> {
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
        resolve({ stdout, stderr, code });
      });
    });
  }

  async function setupE2E() {
    if (fs.existsSync(e2eDir)) {
      fs.rmSync(e2eDir, { recursive: true, force: true });
    }
    fs.mkdirSync(e2eDir, { recursive: true });
  }

  async function teardownE2E() {
    await runCli(['down']);

    if (fs.existsSync(e2eDir)) {
      fs.rmSync(e2eDir, { recursive: true, force: true });
    }
  }

  return { runCli, e2eDir, binPath, setupE2E, teardownE2E };
}
