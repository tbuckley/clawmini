import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanPendingRequests } from './cleanup.js';
import { appendMessage } from './chats.js';

const mockList = vi.fn();
const mockDelete = vi.fn();

vi.mock('./request-store.js', () => {
  return {
    RequestStore: class {
      list = mockList;
      delete = mockDelete;
    },
  };
});

vi.mock('./chats.js', () => ({
  appendMessage: vi.fn(),
}));

vi.mock('../../shared/workspace.js', () => ({
  getWorkspaceRoot: vi.fn(() => '/mock/workspace'),
}));

vi.mock('node:crypto', () => ({
  randomUUID: vi.fn(() => 'mock-uuid'),
}));

describe('cleanPendingRequests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockList.mockReset();
    mockDelete.mockReset();
  });

  it('should delete pending requests and send failed notifications', async () => {
    mockList.mockResolvedValue([
      {
        id: 'req-1',
        state: 'Pending',
        chatId: 'chat-1',
        commandName: 'test',
        subagentId: 'sub-1',
      } as unknown as import('../shared/policies.js').PolicyRequest,
      {
        id: 'req-2',
        state: 'Approved',
        chatId: 'chat-2',
        commandName: 'test2',
      } as unknown as import('../shared/policies.js').PolicyRequest,
      {
        id: 'req-3',
        state: 'Pending',
        chatId: 'chat-1',
        commandName: 'test3',
      } as unknown as import('../shared/policies.js').PolicyRequest,
    ]);
    mockDelete.mockResolvedValue(undefined);

    await cleanPendingRequests();

    expect(mockList).toHaveBeenCalled();
    expect(mockDelete).toHaveBeenCalledTimes(2);
    expect(mockDelete).toHaveBeenCalledWith('req-1');
    expect(mockDelete).toHaveBeenCalledWith('req-3');

    expect(appendMessage).toHaveBeenCalledTimes(2);
    expect(appendMessage).toHaveBeenCalledWith(
      'chat-1',
      expect.objectContaining({
        role: 'system',
        event: 'policy_rejected',
        status: 'rejected',
        content: expect.stringContaining('Daemon restarted before request req-1 was approved.'),
        subagentId: 'sub-1',
      })
    );
  });
});
