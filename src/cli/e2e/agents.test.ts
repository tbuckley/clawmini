import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { createE2EContext } from './utils.js';

const { runCli, e2eDir, setupE2E, teardownE2E } = createE2EContext('e2e-tmp-agents');

describe('E2E Agents Tests', () => {
  beforeAll(async () => {
    await setupE2E();
    await runCli(['init']);
  }, 30000);

  afterAll(teardownE2E, 30000);

  it('should create, list, update and delete agents', async () => {
    const { stdout: stdoutAdd, code: codeAdd } = await runCli([
      'agents',
      'add',
      'test-agent',
      '--directory',
      './test-agent-dir',
      '--template',
      'default',
      '--env',
      'FOO=BAR',
      '--env',
      'BAZ=QUX',
    ]);
    expect(codeAdd).toBe(0);
    expect(stdoutAdd).toContain('Agent test-agent created successfully.');

    const agentSettingsPath = path.resolve(e2eDir, '.clawmini/agents/test-agent/settings.json');
    expect(fs.existsSync(agentSettingsPath)).toBe(true);
    const agentData = JSON.parse(fs.readFileSync(agentSettingsPath, 'utf8'));
    expect(agentData.directory).toBe('./test-agent-dir');
    expect(agentData.env?.FOO).toBe('BAR');
    expect(agentData.env?.BAZ).toBe('QUX');

    const { stdout: stdoutList1 } = await runCli(['agents', 'list']);
    expect(stdoutList1).toContain('- test-agent');

    const { stdout: stdoutUpdate, code: codeUpdate } = await runCli([
      'agents',
      'update',
      'test-agent',
      '--directory',
      './new-dir',
      '--env',
      'FOO=NEW_BAR',
    ]);
    expect(codeUpdate).toBe(0);
    expect(stdoutUpdate).toContain('Agent test-agent updated successfully.');

    const updatedAgentData = JSON.parse(fs.readFileSync(agentSettingsPath, 'utf8'));
    expect(updatedAgentData.directory).toBe('./new-dir');
    expect(updatedAgentData.env?.FOO).toBe('NEW_BAR');
    expect(updatedAgentData.env?.BAZ).toBe('QUX');

    const { stdout: stdoutDelete, code: codeDelete } = await runCli([
      'agents',
      'delete',
      'test-agent',
    ]);
    expect(codeDelete).toBe(0);
    expect(stdoutDelete).toContain('Agent test-agent deleted successfully.');
    expect(fs.existsSync(agentSettingsPath)).toBe(false);
  });
});
