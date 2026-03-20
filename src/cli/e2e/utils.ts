import { spawn, execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

export function createE2EContext(dirName: string) {
  const binPath = path.resolve(__dirname, '../../../dist/cli/index.mjs');
  const e2eDir = path.resolve(__dirname, `../../../${dirName}`);

  function runCli(
    args: string[]
  ): Promise<{ stdout: string; stderr: string; code: number | null }> {
    const isInit = args[0] === 'init';
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
        if (isInit && code === 0) {
          // Update settings to set API port to 0, assigning a random available port
          const settingsPath = path.resolve(e2eDir, '.clawmini/settings.json');
          if (fs.existsSync(settingsPath)) {
            try {
              const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
              const randomPort = Math.floor(Math.random() * 30000) + 30000;
              settings.api = { port: randomPort }; // Use random available port to avoid EADDRINUSE during parallel e2e tests
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

  async function setupE2E() {
    if (fs.existsSync(e2eDir)) {
      fs.rmSync(e2eDir, { recursive: true, force: true });
    }
    fs.mkdirSync(e2eDir, { recursive: true });
    execSync('git init', { cwd: e2eDir, stdio: 'ignore' });
  }

  async function teardownE2E() {
    await runCli(['down']);

    if (fs.existsSync(e2eDir)) {
      fs.rmSync(e2eDir, { recursive: true, force: true });
    }
  }

  return { runCli, e2eDir, binPath, setupE2E, teardownE2E };
}
