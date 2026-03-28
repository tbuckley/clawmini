import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleSubagentPolicyRequest } from './subagent-utils.js';
import * as workspace from '../../shared/workspace.js';
import * as policyUtils from '../policy-utils.js';
import * as chats from '../chats.js';

vi.mock('../../shared/workspace.js', () => ({
  readPolicies: vi.fn(),
  getClawminiDir: vi.fn(() => '/mock/clawmini'),
  getActiveEnvironmentName: vi.fn(),
  updateChatSettings: vi.fn(),
}));

vi.mock('../request-store.js', () => ({
  RequestStore: class {
    save = vi.fn().mockResolvedValue(undefined);
  },
}));

vi.mock('../policy-request-service.js', () => ({
  PolicyRequestService: class {
    createRequest = vi.fn().mockResolvedValue({ id: 'req-1', commandName: 'test', args: [] });
  },
}));

vi.mock('../policy-utils.js', () => ({
  executeRequest: vi.fn(),
  generateRequestPreview: vi.fn().mockResolvedValue('preview content'),
}));

vi.mock('../chats.js', () => ({
  appendMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./router-utils.js', () => ({
  resolveAgentDir: vi.fn().mockResolvedValue('/mock/agent/dir'),
}));

describe('handleSubagentPolicyRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null if source and target environments match', async () => {
    const result = await handleSubagentPolicyRequest(
      'env-a',
      'env-a',
      'chat-1',
      'agent-1',
      undefined,
      'spawn',
      'agent-2',
      'sub-1',
      'prompt text',
      '/workspace'
    );
    expect(result).toBeNull();
  });

  it('throws an error if no policy matches the pseudo-command', async () => {
    vi.mocked(workspace.readPolicies).mockResolvedValue({ policies: {} } as unknown as any);

    await expect(
      handleSubagentPolicyRequest(
        'env-a',
        'env-b',
        'chat-1',
        'agent-1',
        undefined,
        'spawn',
        'agent-2',
        'sub-1',
        'prompt text',
        '/workspace'
      )
    ).rejects.toThrow(/Policy not found: @clawmini\/subagent:env-a:env-b/);
  });

  it('generates a pending request when autoApprove is false', async () => {
    vi.mocked(workspace.readPolicies).mockResolvedValue({
      policies: {
        '@clawmini/subagent:env-a:env-b': {
          autoApprove: false,
        },
      },
    } as unknown as any);

    const result = await handleSubagentPolicyRequest(
      'env-a',
      'env-b',
      'chat-1',
      'agent-1',
      'sub-id-1',
      'spawn',
      'agent-2',
      'sub-2',
      'prompt text',
      '/workspace'
    );

    expect(result).not.toBeNull();
    expect(result?.status).toBe('pending');
    expect(policyUtils.generateRequestPreview).toHaveBeenCalled();
    expect(chats.appendMessage).toHaveBeenCalled();
  });

  it('executes and auto-approves request when autoApprove is true', async () => {
    vi.mocked(workspace.readPolicies).mockResolvedValue({
      policies: {
        '@clawmini/subagent:env-a:env-b': {
          autoApprove: true,
        },
      },
    } as unknown as any);

    vi.mocked(policyUtils.executeRequest).mockResolvedValue({
      stdout: 'ok',
      stderr: '',
      exitCode: 0,
      commandStr: 'mock-cmd',
    });

    const result = await handleSubagentPolicyRequest(
      'env-a',
      'env-b',
      'chat-1',
      'agent-1',
      undefined,
      'send',
      'agent-2',
      'sub-2',
      'prompt text',
      '/workspace'
    );

    expect(result).not.toBeNull();
    expect(result?.status).toBe('approved');
    expect(policyUtils.executeRequest).toHaveBeenCalled();
    expect(chats.appendMessage).toHaveBeenCalled();
  });
});
