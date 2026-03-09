import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createSnapshot, interpolateArgs, executeSafe } from './policy-utils.js';

describe('policy-utils', () => {
  let tempDir: string;
  let workspaceDir: string;
  let snapshotDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clawmini-test-policies-'));
    workspaceDir = path.join(tempDir, 'workspace');
    snapshotDir = path.join(tempDir, 'snapshots');
    await fs.mkdir(workspaceDir, { recursive: true });
    await fs.mkdir(snapshotDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('createSnapshot', () => {
    it('creates a snapshot for a valid file in the workspace', async () => {
      const testFile = path.join(workspaceDir, 'test.txt');
      await fs.writeFile(testFile, 'hello world');

      const snapshotPath = await createSnapshot('test.txt', workspaceDir, snapshotDir);

      expect(snapshotPath).toMatch(/test_[a-f0-9]{16}\.txt$/);
      expect(snapshotPath.startsWith(snapshotDir)).toBe(true);

      const content = await fs.readFile(snapshotPath, 'utf8');
      expect(content).toBe('hello world');
    });

    it('rejects path traversal attempts', async () => {
      const outsideFile = path.join(tempDir, 'outside.txt');
      await fs.writeFile(outsideFile, 'secret');

      await expect(createSnapshot('../outside.txt', workspaceDir, snapshotDir)).rejects.toThrow(
        /Security Error: Path resolves outside/
      );
    });

    it('resolves symlinks and rejects if target is outside workspace', async () => {
      const outsideFile = path.join(tempDir, 'outside.txt');
      await fs.writeFile(outsideFile, 'secret');

      const symlinkPath = path.join(workspaceDir, 'link.txt');
      await fs.symlink(outsideFile, symlinkPath);

      await expect(createSnapshot('link.txt', workspaceDir, snapshotDir)).rejects.toThrow(
        /Security Error: Path resolves outside/
      );
    });

    it('resolves symlinks and allows if target is inside workspace', async () => {
      const targetFile = path.join(workspaceDir, 'target.txt');
      await fs.writeFile(targetFile, 'target content');

      const symlinkPath = path.join(workspaceDir, 'link.txt');
      await fs.symlink(targetFile, symlinkPath);

      const snapshotPath = await createSnapshot('link.txt', workspaceDir, snapshotDir);
      const content = await fs.readFile(snapshotPath, 'utf8');
      expect(content).toBe('target content');
    });

    it('rejects files over 5MB', async () => {
      const largeFile = path.join(workspaceDir, 'large.txt');
      // Create a dummy large file using truncate
      const fd = await fs.open(largeFile, 'w');
      await fd.truncate(5 * 1024 * 1024 + 100); // slightly over 5MB
      await fd.close();

      await expect(createSnapshot('large.txt', workspaceDir, snapshotDir)).rejects.toThrow(
        /exceeds maximum snapshot size of 5MB/
      );
    });

    it('rejects non-files (directories)', async () => {
      const dirPath = path.join(workspaceDir, 'subdir');
      await fs.mkdir(dirPath);

      await expect(createSnapshot('subdir', workspaceDir, snapshotDir)).rejects.toThrow(
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
});
