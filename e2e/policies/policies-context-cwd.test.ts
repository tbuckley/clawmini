import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import path from 'node:path';
import fsPromises from 'node:fs/promises';
import { createTRPCClient, httpLink, TRPCClientError } from '@trpc/client';
import { TestEnvironment } from '../_helpers/test-environment.js';
import type { AgentRouter } from '../../src/daemon/api/agent-router.js';
import type {
  CommandLogMessage,
  PolicyRequestMessage,
} from '../../src/daemon/chats.js';

describe('Context-Aware Execution E2E', () => {
  let env: TestEnvironment;

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
  afterEach(() => env.disconnect());

  it('should execute policy in the requested subdirectory', async () => {
    await env.runCli(['chats', 'add', 'chat-cwd']);
    await env.connect('chat-cwd');

    // Simulate the agent navigating to 'foo' and calling the policy.
    await env.sendMessage('cd foo && clawmini-lite.js request print-cwd', {
      chat: 'chat-cwd',
      agent: 'debug-agent',
    });

    const policy = await env.waitForMessage(
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
      await env.runCli(['chats', 'add', 'creds-chat']);
      await env.connect('creds-chat');
      await env.sendMessage(
        'echo "URL=$CLAW_API_URL" && echo "TOKEN=$CLAW_API_TOKEN"',
        { chat: 'creds-chat', agent: 'debug-agent' }
      );
      const log = await env.waitForMessage((m): m is CommandLogMessage => m.role === 'command');
      // Match start-of-line to skip the debug template's own [DEBUG] ... echo
      // line, which contains the literal text "URL=$CLAW_API_URL".
      const url = log.stdout.match(/^URL=(.+)$/m)![1]!.trim();
      const token = log.stdout.match(/^TOKEN=(.+)$/m)![1]!.trim();
      await env.disconnect();

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
