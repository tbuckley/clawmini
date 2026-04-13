import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  createSnapshot,
  interpolateArgs,
  executeSafe,
  MAX_SNAPSHOT_SIZE,
  translateSandboxPath,
} from './policy-utils.js';

describe('policy-utils', () => {
  let tempDir: string;
  let agentDir: string;
  let snapshotDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clawmini-test-policies-'));
    agentDir = path.join(tempDir, 'agent');
    snapshotDir = path.join(tempDir, 'snapshots');
    await fs.mkdir(agentDir, { recursive: true });
    await fs.mkdir(snapshotDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('createSnapshot', () => {
    it('creates a snapshot for a valid file in the agent directory', async () => {
      const testFile = path.join(agentDir, 'test.txt');
      await fs.writeFile(testFile, 'hello world');

      const snapshotPath = await createSnapshot('test.txt', agentDir, snapshotDir);

      expect(snapshotPath).toMatch(/test_[a-f0-9]{16}\.txt$/);
      expect(snapshotPath.startsWith(snapshotDir)).toBe(true);

      const content = await fs.readFile(snapshotPath, 'utf8');
      expect(content).toBe('hello world');
    });

    it('rejects path traversal attempts', async () => {
      const outsideFile = path.join(tempDir, 'outside.txt');
      await fs.writeFile(outsideFile, 'secret');

      await expect(createSnapshot('../outside.txt', agentDir, snapshotDir)).rejects.toThrow(
        /Security Error: Path resolves outside/
      );
    });

    it('rejects symlinks completely', async () => {
      const targetFile = path.join(agentDir, 'target.txt');
      await fs.writeFile(targetFile, 'target content');

      const symlinkPath = path.join(agentDir, 'link.txt');
      await fs.symlink(targetFile, symlinkPath);

      await expect(createSnapshot('link.txt', agentDir, snapshotDir)).rejects.toThrow(
        /Security Error: Symlinks are not allowed/
      );
    });

    it('rejects files over MAX_SNAPSHOT_SIZE', async () => {
      const largeFile = path.join(agentDir, 'large.txt');
      const fd = await fs.open(largeFile, 'w');
      await fd.truncate(MAX_SNAPSHOT_SIZE + 100);
      await fd.close();

      await expect(createSnapshot('large.txt', agentDir, snapshotDir)).rejects.toThrow(
        /exceeds maximum snapshot size of 5MB/
      );
    });

    it('rejects non-files (directories)', async () => {
      const dirPath = path.join(agentDir, 'subdir');
      await fs.mkdir(dirPath);

      await expect(createSnapshot('subdir', agentDir, snapshotDir)).rejects.toThrow(
        /Requested path is not a file/
      );
    });
  });

  describe('interpolateArgs', () => {
    it('replaces variables with snapshot paths', () => {
      const args = ['--to', 'admin@example.com', '--body', '{{body_txt}}'];
      const mappings = {
        body_txt: '/tmp/snapshots/test_123.txt',
      };

      const result = interpolateArgs(args, mappings);
      expect(result).toEqual([
        '--to',
        'admin@example.com',
        '--body',
        '/tmp/snapshots/test_123.txt',
      ]);
    });

    it('replaces multiple occurrences in a single arg', () => {
      const args = ['--config', 'file1={{f1}},file2={{f2}}'];
      const mappings = {
        f1: '/tmp/f1.txt',
        f2: '/tmp/f2.txt',
      };

      const result = interpolateArgs(args, mappings);
      expect(result).toEqual(['--config', 'file1=/tmp/f1.txt,file2=/tmp/f2.txt']);
    });

    it('leaves unmatched variables alone', () => {
      const args = ['--arg', '{{unknown}}'];
      const mappings = {};
      const result = interpolateArgs(args, mappings);
      expect(result).toEqual(['--arg', '{{unknown}}']);
    });
  });

  describe('executeSafe', () => {
    it('executes a command and returns output', async () => {
      const result = await executeSafe('echo', ['hello', 'world']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('hello world');
      expect(result.stderr).toBe('');
    });

    it('handles command failures gracefully', async () => {
      // Execute ls on a non-existent file
      const result = await executeSafe('ls', ['/does/not/exist/12345']);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toMatch(/No such file or directory/);
    });

    it('does not execute shell operators (injection prevention)', async () => {
      // If shell was true, `echo hello && echo injected` would run two commands.
      // Since shell is false, it treats `&&` and `echo injected` as arguments to echo.
      const result = await executeSafe('echo', ['hello', '&&', 'echo', 'injected']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('hello && echo injected');
    });
  });

  describe('translateSandboxPath', () => {
    it('strips baseDir from sandboxCwd and resolves against agentDir', () => {
      const sandboxCwd = '/app/src/components';
      const baseDir = '/app';
      const hostAgentDir = '/Users/host/projects/agent1';

      const result = translateSandboxPath(sandboxCwd, baseDir, hostAgentDir);
      expect(result).toBe(path.resolve('/Users/host/projects/agent1', 'src/components'));
    });

    it('handles sandboxCwd exactly matching baseDir', () => {
      const sandboxCwd = '/app';
      const baseDir = '/app';
      const hostAgentDir = '/Users/host/projects/agent1';

      const result = translateSandboxPath(sandboxCwd, baseDir, hostAgentDir);
      expect(result).toBe(path.resolve('/Users/host/projects/agent1'));
    });

    it('resolves properly when baseDir is undefined by treating sandboxCwd as relative to agentDir', () => {
      const sandboxCwd = '/src/index.js';
      const hostAgentDir = '/Users/host/projects/agent1';

      const result = translateSandboxPath(sandboxCwd, undefined, hostAgentDir);
      expect(result).toBe(path.resolve('/Users/host/projects/agent1', 'src/index.js'));
    });

    it('handles sandboxCwd without leading slash when baseDir is undefined', () => {
      const sandboxCwd = 'src/index.js';
      const hostAgentDir = '/Users/host/projects/agent1';

      const result = translateSandboxPath(sandboxCwd, undefined, hostAgentDir);
      expect(result).toBe(path.resolve('/Users/host/projects/agent1', 'src/index.js'));
    });

    it('throws error on directory escape (path traversal)', () => {
      const sandboxCwd = '/app/../../etc/passwd';
      const baseDir = '/app';
      const hostAgentDir = '/Users/host/projects/agent1';

      expect(() => translateSandboxPath(sandboxCwd, baseDir, hostAgentDir)).toThrow(
        /Security Error: Path resolves outside the allowed agent directory/
      );
    });

    it('throws error if sandboxCwd without baseDir tries to escape', () => {
      const sandboxCwd = '../outside';
      const hostAgentDir = '/Users/host/projects/agent1';

      expect(() => translateSandboxPath(sandboxCwd, undefined, hostAgentDir)).toThrow(
        /Security Error: Path resolves outside the allowed agent directory/
      );
    });

    it('allows resolving to the agent directory itself', () => {
      const sandboxCwd = '/app';
      const baseDir = '/app';
      const hostAgentDir = path.resolve('/Users/host/projects/agent1');

      const result = translateSandboxPath(sandboxCwd, baseDir, hostAgentDir);
      expect(result).toBe(hostAgentDir);
    });
  });
});
