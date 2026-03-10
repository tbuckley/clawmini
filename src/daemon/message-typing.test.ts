/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executeDirectMessage } from './message.js';
import * as events from './events.js';

vi.mock('./events.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./events.js')>();
  return {
    ...actual,
    emitTyping: vi.fn(),
    emitMessageAppended: vi.fn(),
  };
});

vi.mock('../shared/chats.js', () => ({
  appendMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./queue.js', () => ({
  getQueue: vi.fn().mockReturnValue({
    enqueue: (fn: any) => fn(),
  }),
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

describe('executeDirectMessage - Typing Indicator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should emit typing events at an interval and clear them upon completion', async () => {
    const chatId = 'test-typing-chat';
    const state = {
      message: 'hello typing',
      chatId,
      messageId: 'mock-id',
    };
    const settings = {
      defaultAgent: {
        commands: { new: 'echo start' },
      },
    } as any;

    // We mock runCommand to delay its completion so we can advance timers
    const mockRunCommand = vi.fn().mockImplementation(() => {
      return new Promise((resolve) => {
        // We simulate that command takes 12000ms
        setTimeout(() => {
          resolve({ stdout: 'done', stderr: '', exitCode: 0 });
        }, 12000);
      });
    });

    const execPromise = executeDirectMessage(chatId, state, settings, '/dir', mockRunCommand, true);

    // Advance time by 5000ms. Interval is set to 5000ms.
    await vi.advanceTimersByTimeAsync(5000);
    expect(events.emitTyping).toHaveBeenCalledTimes(1);
    expect(events.emitTyping).toHaveBeenCalledWith(chatId);

    // Advance time by another 5000ms (10000ms total)
    await vi.advanceTimersByTimeAsync(5000);
    expect(events.emitTyping).toHaveBeenCalledTimes(2);

    // Advance time past the command finish (12000ms total)
    await vi.advanceTimersByTimeAsync(2000);
    await execPromise;

    // Now the command is finished, interval should be cleared
    // Advance by another 10000ms, it shouldn't trigger again
    await vi.advanceTimersByTimeAsync(10000);

    // Total should still be 2, because the interval was cleared.
    expect(events.emitTyping).toHaveBeenCalledTimes(2);
  });
});
