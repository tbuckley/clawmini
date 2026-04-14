import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createE2EContext, setupSubagentEnv, waitForMessage } from '../_helpers/utils.js';
import path from 'node:path';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import { createTRPCClient, httpLink, TRPCClientError } from '@trpc/client';
import type { AgentRouter } from '../../src/daemon/api/agent-router.js';

const { runCli, e2eDir, setupE2E, teardownE2E } = createE2EContext('e2e-context-cwd');

describe('Context-Aware Execution E2E', () => {
  beforeAll(async () => {
    await setupE2E();
    await setupSubagentEnv(runCli, e2eDir, {
      port: 3018,
      policies: {
        'print-cwd': {
          description: 'Print the current working directory',
          command: 'pwd',
          args: [],
          autoApprove: true,
        },
      },
    });

    // Create a subdirectory 'foo' in the debug-agent's directory
    const agentDir = path.join(e2eDir, 'debug-agent');
    await fsPromises.mkdir(path.join(agentDir, 'foo'), { recursive: true });
  }, 30000);

  afterAll(teardownE2E, 30000);

  it('should execute policy in the requested subdirectory', async () => {
    await runCli(['chats', 'add', 'chat-cwd']);

    // Send a message that simulates the agent navigating to 'foo' and calling the policy.
    await runCli([
      'messages',
      'send',
      `cd foo && clawmini-lite.js request print-cwd`,
      '--chat',
      'chat-cwd',
      '--agent',
      'debug-agent',
    ]);

    const replyMsg = await waitForMessage(
      e2eDir,
      'chat-cwd',
      (m: Record<string, unknown>) => m.role === 'policy' && m.status === 'approved'
    );

    expect(replyMsg).not.toBeNull();
    // The policy's output should contain 'foo' as the current working directory
    expect(replyMsg!.content).toContain('foo');

    // Check that it's actually within the debug-agent's foo folder
    expect(replyMsg!.content).toContain(path.join('debug-agent', 'foo'));
  }, 30000);

  // The tests below need to send a *crafted* sandbox-relative cwd directly to
  // the tRPC endpoint, because lite always sends process.cwd() (an absolute
  // host path). We extract the debug-agent's API credentials by dumping its
  // environment into a file via the debug template's shell-eval command.
  describe('direct tRPC cwd handling', () => {
    let agentClient: ReturnType<typeof createTRPCClient<AgentRouter>>;

    beforeAll(async () => {
      await runCli(['chats', 'add', 'env-dump-chat']);
      await runCli([
        'messages',
        'send',
        'env > agent-env.txt',
        '--chat',
        'env-dump-chat',
        '--agent',
        'debug-agent',
      ]);

      const envFile = path.join(e2eDir, 'debug-agent', 'agent-env.txt');
      for (let i = 0; i < 40; i++) {
        if (fs.existsSync(envFile)) break;
        await new Promise((r) => setTimeout(r, 250));
      }
      if (!fs.existsSync(envFile)) {
        throw new Error('debug-agent env dump never produced agent-env.txt');
      }

      const envContent = fs.readFileSync(envFile, 'utf8');
      const url = envContent.match(/CLAW_API_URL=(.+)/)?.[1]?.trim();
      const token = envContent.match(/CLAW_API_TOKEN=(.+)/)?.[1]?.trim();
      if (!url || !token) {
        throw new Error('Could not extract API credentials from agent env');
      }

      agentClient = createTRPCClient<AgentRouter>({
        links: [
          httpLink({
            url,
            headers: () => ({ Authorization: `Bearer ${token}` }),
          }),
        ],
      });
    }, 30000);

    it('should strip environment baseDir from a sandbox-relative cwd', async () => {
      // Configure an environment with a baseDir. The environment matches the
      // debug-agent directory, so when the agent reports cwd `/sandbox/foo`,
      // the server strips `/sandbox` and executes inside `<agentDir>/foo`.
      const envConfigDir = path.resolve(e2eDir, '.clawmini/environments/sandboxed');
      await fsPromises.mkdir(envConfigDir, { recursive: true });
      await fsPromises.writeFile(
        path.join(envConfigDir, 'env.json'),
        JSON.stringify({ baseDir: '/sandbox' })
      );

      const settingsPath = path.resolve(e2eDir, '.clawmini/settings.json');
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      settings.environments = { ...(settings.environments ?? {}), './debug-agent': 'sandboxed' };
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

      const result = await agentClient.createPolicyRequest.mutate({
        commandName: 'print-cwd',
        args: [],
        fileMappings: {},
        cwd: '/sandbox/foo',
      });

      expect(result.executionResult).toBeDefined();
      expect(result.executionResult!.exitCode).toBe(0);
      expect(result.executionResult!.stdout).toContain(path.join('debug-agent', 'foo'));
    }, 15000);

    it('should reject a cwd that escapes the agent directory', async () => {
      // Remove the environment setup from the previous test so the baseDir
      // branch does not apply here.
      const settingsPath = path.resolve(e2eDir, '.clawmini/settings.json');
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      delete settings.environments;
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

      await expect(
        agentClient.createPolicyRequest.mutate({
          commandName: 'print-cwd',
          args: [],
          fileMappings: {},
          cwd: '../../escape',
        })
      ).rejects.toSatisfy((err: unknown) => {
        return (
          err instanceof TRPCClientError &&
          /Security Error: Path resolves outside/.test(err.message)
        );
      });
    }, 15000);
  });
});
