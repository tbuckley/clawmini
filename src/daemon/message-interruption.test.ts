import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeDirectMessage } from './message.js';
import { getQueue } from './queue.js';
import type { RouterState } from './routers/types.js';

vi.mock('./chats.js', () => ({
  appendMessage: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../shared/workspace.js', () => ({
  readChatSettings: vi.fn().mockResolvedValue(null),
  writeChatSettings: vi.fn().mockResolvedValue(undefined),
  readAgentSessionSettings: vi.fn().mockResolvedValue(null),
  writeAgentSessionSettings: vi.fn().mockResolvedValue(undefined),
  getAgent: vi.fn().mockResolvedValue(null),
  getWorkspaceRoot: vi.fn().mockImplementation((cwd) => cwd),
  getActiveEnvironmentName: vi.fn().mockResolvedValue(null),
  getEnvironmentPath: vi.fn().mockReturnValue(''),
  readEnvironment: vi.fn().mockResolvedValue(null),
}));

describe('Interruption flow in message handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stops execution and clears queue when action is stop', async () => {
    const queue = getQueue('/test-interrupt-stop');
    const abortSpy = vi.spyOn(queue, 'abortCurrent');
    const clearSpy = vi.spyOn(queue, 'clear');

    const state: RouterState = {
      message: 'stop everything',
      messageId: 'mock-msg-id',
      chatId: 'chat1',
      action: 'stop',
    };

    const runCommand = vi.fn();
    await executeDirectMessage('chat1', state, undefined, '/test-interrupt-stop', runCommand, true);

    expect(abortSpy).toHaveBeenCalled();
    expect(clearSpy).toHaveBeenCalled();
    expect(runCommand).not.toHaveBeenCalled();

    // We expect it NOT to enqueue because it returns early
    expect(queue['pending'].length).toBe(0);
  });

  it('interrupts execution and batches pending tasks when action is interrupt', async () => {
    const queue = getQueue('/test-interrupt-batch');
    const abortSpy = vi.spyOn(queue, 'abortCurrent');

    // Block the queue with a running task so subsequent ones stay pending
    queue
      .enqueue(async () => {
        await new Promise((r) => setTimeout(r, 500));
      })
      .catch(() => {});

    // Enqueue some dummy tasks with payloads
    queue
      .enqueue(async () => {
        await new Promise((r) => setTimeout(r, 100));
      }, 'pending 1')
      .catch(() => {});
    queue
      .enqueue(async () => {
        await new Promise((r) => setTimeout(r, 100));
      }, 'pending 2')
      .catch(() => {});

    const state: RouterState = {
      message: 'new urgent task',
      messageId: 'mock-msg-id',
      chatId: 'chat1',
      action: 'interrupt',
    };

    const runCommand = vi.fn().mockResolvedValue({ stdout: 'done', stderr: '', exitCode: 0 });

    await executeDirectMessage(
      'chat1',
      state,
      undefined,
      '/test-interrupt-batch',
      runCommand,
      true
    );

    expect(abortSpy).toHaveBeenCalled();

    // Should have concatenated the pending tasks with the new message
    // and enqueued it.

    // In our executeDirectMessage, the state.message gets mutated.
    // However, it's easier to verify what was enqueued by extracting pending again,
    // or by checking state.message.
    expect(state.message).toBe(
      '<message>\npending 1\n</message>\n\n<message>\npending 2\n</message>\n\n<message>\nnew urgent task\n</message>'
    );
  });

  it('returns early when message is empty and no action is specified', async () => {
    const queue = getQueue('/test-interrupt-empty');
    const state: RouterState = {
      message: '   ',
      messageId: 'mock-msg-id',
      chatId: 'chat1',
    };

    const runCommand = vi.fn();
    await executeDirectMessage(
      'chat1',
      state,
      undefined,
      '/test-interrupt-empty',
      runCommand,
      true
    );

    expect(runCommand).not.toHaveBeenCalled();
    expect(queue['pending'].length).toBe(0);
  });
});
