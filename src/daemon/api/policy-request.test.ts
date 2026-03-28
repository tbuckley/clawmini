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
  readPolicies: vi.fn().mockResolvedValue({
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

vi.mock('../policy-request-service.js', () => {
  return {
    PolicyRequestService: class {
      async createRequest() {
        return {
          id: 'req-123',
          commandName: 'test-cmd',
          args: ['arg1', 'arg2'],
          fileMappings: {
            file1: '/mock/.clawmini/tmp/snapshots/file1.txt',
            file2: '/mock/.clawmini/tmp/snapshots/file2.txt',
          },
          state: 'Pending',
          createdAt: Date.now(),
          chatId: 'chat-1',
          agentId: 'agent-1',
        };
      }
    },
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
    },
    readFile: mockReadFile,
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    readdir: vi.fn().mockResolvedValue([]),
    realpath: vi.fn().mockImplementation((p) => Promise.resolve(p)),
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
        file1: '/mock/workspace/file1',
        file2: '/mock/workspace/file2',
      },
    });

    expect(result.id).toBe('req-123');

    expect(chats.appendMessage).toHaveBeenCalledTimes(1);
    const callArgs = vi.mocked(chats.appendMessage).mock.calls[0]!;
    const chatId = callArgs[0];
    const logMsg = callArgs[1] as any;

    expect(chatId).toBe('default-chat');
    expect(logMsg.role).toBe('policy');

    // Assert preview content format
    const content = logMsg.content;
    expect(content).toContain('Sandbox Policy Request: test-cmd');
    expect(content).toContain('ID: req-123');
    expect(content).toContain('Args: arg1 arg2');

    expect(content).toContain('File [file1]:\n' + shortContent);

    // The long file should be truncated to 500 chars + suffix
    expect(content).toContain('File [file2]:\n' + 'A'.repeat(500) + '\n... (truncated)');
    expect(content).toContain('Use /approve req-123 or /reject req-123 [reason]');
  });

  it('should create an auto-approved request and execute it immediately', async () => {
    const caller = appRouter.createCaller({
      isApiServer: true,
      tokenPayload: { agentId: 'default', chatId: 'default-chat' },
    } as any);

    const result = await caller.createPolicyRequest({
      commandName: 'auto-cmd',
      args: ['hello'],
      fileMappings: {},
    });

    expect(result.id).toBe('REQ-123');
    expect(result.executionResult).toBeDefined();

    expect(chats.appendMessage).toHaveBeenCalledTimes(1);
    const callArgs = vi.mocked(chats.appendMessage).mock.calls[0]!;
    const logMsg = callArgs[1] as any;

    expect(logMsg.content).toContain('[Auto-approved] Policy auto-cmd was executed.');
    expect(logMsg.role).toBe('policy');
    expect(logMsg.status).toBe('approved');
  });
});
