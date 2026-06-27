/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { agentRouter as appRouter } from './index.js';
import * as chats from '../../shared/chats.js';

vi.mock('../../shared/chats.js', () => ({
  getDefaultChatId: vi.fn().mockResolvedValue('default-chat'),
  appendMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../shared/workspace.js', () => ({
  getWorkspaceRoot: vi.fn().mockReturnValue('/mock/workspace'),
  getClawminiDir: vi.fn().mockReturnValue('/mock/.clawmini'),
  getActiveEnvironmentInfo: vi.fn().mockResolvedValue(null),
  readEnvironment: vi.fn().mockResolvedValue(null),
  readPoliciesForPath: vi.fn().mockResolvedValue({
    policies: {
      'test-cmd': {
        command: 'echo',
        autoApprove: false,
      },
      'auto-cmd': {
        command: 'echo',
        autoApprove: true,
      },
    },
  }),
}));

vi.mock('../delegation-manager.js', () => {
  return {
    DelegationManager: class {
      async createPolicy(opts: any) {
        return {
          id: 'REQ-123',
          kind: 'policy',
          commandName: opts.commandName,
          args: opts.args,
          fileMappings: opts.fileMappings,
          state: 'pending',
          createdAt: Date.now().toString(),
          chatId: opts.chatId,
          agentId: opts.agentId,
        };
      }
      async approve() {}
      async markResolved() {}
    },
  };
});

vi.mock('../delegation-store.js', () => {
  return {
    DelegationStore: class {},
  };
});

vi.mock('../policy-utils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../policy-utils.js')>();
  return {
    ...actual,
    createSnapshot: vi
      .fn()
      .mockImplementation(async (path) => `/mock/.clawmini/tmp/snapshots/${path}`),
    executeRequest: vi.fn().mockResolvedValue({
      stdout: 'auto executed',
      stderr: '',
      exitCode: 0,
      commandStr: 'echo auto executed',
    }),
    truncateLargeOutput: vi.fn().mockResolvedValue({
      stdout: 'auto executed',
      stderr: '',
    }),
  };
});

const { mockReadFile } = vi.hoisted(() => {
  return { mockReadFile: vi.fn() };
});

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    default: {
      ...actual,
      readFile: mockReadFile,
      writeFile: vi.fn(),
      mkdir: vi.fn(),
      readdir: vi.fn().mockResolvedValue([]),
      realpath: vi.fn().mockImplementation((p) => Promise.resolve(p)),
      lstat: vi
        .fn()
        .mockResolvedValue({ isSymbolicLink: () => false, isFile: () => true, size: 100 }),
      copyFile: vi.fn(),
    },
    readFile: mockReadFile,
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    readdir: vi.fn().mockResolvedValue([]),
    realpath: vi.fn().mockImplementation((p) => Promise.resolve(p)),
    lstat: vi
      .fn()
      .mockResolvedValue({ isSymbolicLink: () => false, isFile: () => true, size: 100 }),
    copyFile: vi.fn(),
  };
});

describe('createPolicyRequest preview message', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a request and append a preview message truncating long files', async () => {
    const caller = appRouter.createCaller({
      isApiServer: true,
      tokenPayload: { agentId: 'default', chatId: 'default-chat' },
    } as any);

    // file1 is short, file2 is long
    const shortContent = 'Hello world!';
    const longContent = 'A'.repeat(600);

    mockReadFile.mockImplementation(async (filePath: any) => {
      if (filePath.toString().includes('file1')) return shortContent;
      if (filePath.toString().includes('file2')) return longContent;
      return '';
    });

    const result = await caller.createPolicyRequest({
      commandName: 'test-cmd',
      args: ['arg1', 'arg2'],
      fileMappings: {
        file1: 'file1',
        file2: 'file2',
      },
    });

    expect(result.id).toBe('REQ-123');

    // Check that appendMessage was called
    expect(chats.appendMessage).toHaveBeenCalledTimes(1);

    const callArgs = vi.mocked(chats.appendMessage).mock.calls[0];
    expect(callArgs).toBeDefined();

    const [chatIdArg, msgArg] = callArgs as [string, any];
    expect(chatIdArg).toBe('default-chat');

    const content = msgArg.content as string;

    // It should contain the short file
    expect(content).toContain('Hello world!');

    // It should truncate the long file
    expect(content).toContain('A'.repeat(500));
    expect(content).toContain('... (truncated)');
    expect(content).not.toContain('A'.repeat(501));
  });

  it('should create an auto-approved request and execute it immediately', async () => {
    const caller = appRouter.createCaller({
      isApiServer: true,
      tokenPayload: { agentId: 'default', chatId: 'default-chat' },
    } as any);

    const result = await caller.createPolicyRequest({
      commandName: 'auto-cmd',
      args: ['arg1'],
      fileMappings: {},
    });

    expect(result.id).toBe('REQ-123');

    expect(chats.appendMessage).toHaveBeenCalledTimes(1);
    const callArgs = vi.mocked(chats.appendMessage).mock.calls[0];
    const msgArg = callArgs![1] as any;

    expect(msgArg.role).toBe('policy');
    expect(msgArg.status).toBe('approved');
    expect(msgArg.content).toContain('[Auto-approved]');
    expect(msgArg.content).toContain('auto executed');
  });
});
