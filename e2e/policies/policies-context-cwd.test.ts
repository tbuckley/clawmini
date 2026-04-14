import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import path from 'node:path';
import fsPromises from 'node:fs/promises';
import { createTRPCClient, httpLink, TRPCClientError } from '@trpc/client';
import { TestEnvironment, type ChatSubscription } from '../_helpers/test-environment.js';
import type { AgentRouter } from '../../src/daemon/api/agent-router.js';
import type { PolicyRequestMessage } from '../../src/daemon/chats.js';

describe('Context-Aware Execution E2E', () => {
  let env: TestEnvironment;
  let chat: ChatSubscription | undefined;

  beforeAll(async () => {
    env = new TestEnvironment('e2e-context-cwd');
    await env.setup();
    await env.setupSubagentEnv({
      policies: {
        'print-cwd': {
          description: 'Print the current working directory',
          command: 'pwd',
          args: [],
          autoApprove: true,
        },
      },
    });

    // Create a 'foo' subdirectory inside the debug-agent's working directory.
    await fsPromises.mkdir(path.join(env.e2eDir, 'debug-agent', 'foo'), { recursive: true });
  }, 30000);

  afterAll(() => env.teardown(), 30000);
  afterEach(async () => {
    await chat?.disconnect();
    chat = undefined;
  });

  it('should execute policy in the requested subdirectory', async () => {
    await env.runCli(['chats', 'add', 'chat-cwd']);
    chat = await env.connect('chat-cwd');

    // Simulate the agent navigating to 'foo' and calling the policy.
    await env.sendMessage('cd foo && clawmini-lite.js request print-cwd', {
      chat: 'chat-cwd',
      agent: 'debug-agent',
    });

    const policy = await chat.waitForMessage(
      (m): m is PolicyRequestMessage => m.role === 'policy' && m.status === 'approved'
    );
    expect(policy.content).toContain(path.join('debug-agent', 'foo'));
  }, 30000);

  // The tests below send a *crafted* sandbox-relative cwd directly to the
  // tRPC endpoint, because lite always sends process.cwd() (an absolute host
  // path). We extract the debug-agent's API credentials by asking it to echo
  // them to stdout.
  describe('direct tRPC cwd handling', () => {
    let agentClient: ReturnType<typeof createTRPCClient<AgentRouter>>;

    beforeAll(async () => {
      const { url, token } = await env.getAgentCredentials();
      agentClient = createTRPCClient<AgentRouter>({
        links: [httpLink({ url, headers: () => ({ Authorization: `Bearer ${token}` }) })],
      });
    }, 30000);

    it('should strip environment baseDir from a sandbox-relative cwd', async () => {
      // Configure an environment with a baseDir. The environment matches the
      // debug-agent directory, so when the agent reports cwd `/sandbox/foo`,
      // the server strips `/sandbox` and executes inside `<agentDir>/foo`.
      const envConfigDir = path.resolve(env.e2eDir, '.clawmini/environments/sandboxed');
      await fsPromises.mkdir(envConfigDir, { recursive: true });
      await fsPromises.writeFile(
        path.join(envConfigDir, 'env.json'),
        JSON.stringify({ baseDir: '/sandbox' })
      );

      env.updateSettings({ environments: { './debug-agent': 'sandboxed' } });

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
      const settings = env.getSettings();
      delete settings.environments;
      env.writeSettings(settings);

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
