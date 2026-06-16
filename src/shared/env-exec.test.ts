import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { wrapCommandForEnvironment } from './env-exec.js';

describe('wrapCommandForEnvironment', () => {
  const testDir = path.join(process.cwd(), '.clawmini-test-env-exec');
  const clawminiDir = path.join(testDir, '.clawmini');
  const envName = 'test-env';
  const envDir = path.join(clawminiDir, 'environments', envName);

  beforeEach(async () => {
    await fsPromises.mkdir(envDir, { recursive: true });
  });

  afterEach(async () => {
    if (fs.existsSync(testDir)) {
      await fsPromises.rm(testDir, { recursive: true, force: true });
    }
  });

  it('throws when the environment does not exist', async () => {
    await expect(
      wrapCommandForEnvironment('missing', 'echo hi', { startDir: testDir })
    ).rejects.toThrow(/Environment not found/);
  });

  it('returns the bare command when no prefix is defined', async () => {
    await fsPromises.writeFile(path.join(envDir, 'env.json'), JSON.stringify({}));
    const result = await wrapCommandForEnvironment(envName, 'echo hi', { startDir: testDir });
    expect(result.command).toBe('echo hi');
    expect(result.env).toEqual({});
  });

  it('substitutes {COMMAND} in the prefix', async () => {
    await fsPromises.writeFile(
      path.join(envDir, 'env.json'),
      JSON.stringify({ prefix: "sandbox sh -c '{COMMAND}'" })
    );
    const result = await wrapCommandForEnvironment(envName, 'echo hi', { startDir: testDir });
    expect(result.command).toBe("sandbox sh -c 'echo hi'");
  });

  it('appends the command when {COMMAND} is absent from the prefix', async () => {
    await fsPromises.writeFile(
      path.join(envDir, 'env.json'),
      JSON.stringify({ prefix: 'wrap run {ENV_ARGS}' })
    );
    const result = await wrapCommandForEnvironment(envName, 'echo hi', { startDir: testDir });
    expect(result.command).toBe('wrap run  echo hi');
  });

  it('interpolates path placeholders in the prefix', async () => {
    await fsPromises.writeFile(
      path.join(envDir, 'env.json'),
      JSON.stringify({
        prefix: "{ENV_DIR}/run.sh '{WORKSPACE_DIR}' '{AGENT_DIR}' '{HOME_DIR}' '{COMMAND}'",
      })
    );
    const result = await wrapCommandForEnvironment(envName, 'echo hi', {
      startDir: testDir,
      workspaceDir: '/ws',
      agentDir: '/ws/agents/x',
    });
    expect(result.command).toBe(
      `${envDir}/run.sh '/ws' '/ws/agents/x' '${process.env.HOME || ''}' 'echo hi'`
    );
  });

  it('resolves env values and interpolates placeholders', async () => {
    await fsPromises.writeFile(
      path.join(envDir, 'env.json'),
      JSON.stringify({
        env: {
          PATH: '{PATH}:{WORKSPACE_DIR}/.local/bin',
          HTTP_PROXY: 'http://127.0.0.1:8888',
          DROPPED: false,
        },
      })
    );
    const original = process.env.PATH;
    process.env.PATH = '/usr/bin';
    try {
      const result = await wrapCommandForEnvironment(envName, 'cmd', {
        startDir: testDir,
        workspaceDir: '/ws',
      });
      expect(result.env).toEqual({
        PATH: '/usr/bin:/ws/.local/bin',
        HTTP_PROXY: 'http://127.0.0.1:8888',
      });
    } finally {
      process.env.PATH = original;
    }
  });
});
