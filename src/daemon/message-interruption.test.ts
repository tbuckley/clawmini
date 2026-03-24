import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeDirectMessage } from './message.js';
import { taskScheduler } from './agent/task-scheduler.js';
import type { RouterState } from './routers/types.js';
import { runCommand } from './utils/spawn.js';
import { randomUUID } from 'node:crypto';

vi.mock('./utils/spawn.js', () => ({ runCommand: vi.fn() }));

vi.mock('./chats.js', () => ({
  appendMessage: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../shared/workspace.js', () => ({
  resolveAgentWorkDir: vi
    .fn()
    .mockImplementation((id, dir, root) => (dir ? `${root}/${dir}` : `${root}/${id}`)),

  readSettings: vi.fn().mockResolvedValue(null),

  readChatSettings: vi.fn().mockResolvedValue(null),
  writeChatSettings: vi.fn().mockResolvedValue(undefined),
  readAgentSessionSettings: vi.fn().mockResolvedValue(null),
  writeAgentSessionSettings: vi.fn().mockResolvedValue(undefined),
  getAgent: vi.fn().mockResolvedValue(null),
  getWorkspaceRoot: vi.fn().mockImplementation((cwd) => cwd),
  getActiveEnvironmentName: vi.fn().mockResolvedValue(null),
  getActiveEnvironmentInfo: vi.fn().mockResolvedValue(null),
  getEnvironmentPath: vi.fn().mockReturnValue(''),
  readEnvironment: vi.fn().mockResolvedValue(null),
}));

describe('Interruption flow in message handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stops execution and clears queue when action is stop', async () => {
    const sessionId = 'test-interrupt-stop';
    taskScheduler.abortTasks(sessionId);
    const abortSpy = vi.spyOn(taskScheduler, 'abortTasks');

    const state: RouterState = {
      message: 'stop everything',
      messageId: 'mock-msg-id',
      chatId: 'chat1',
      action: 'stop',
      sessionId,
    };

    vi.mocked(runCommand).mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
    await executeDirectMessage('chat1', state, undefined, '/test-interrupt-stop', true);

    expect(abortSpy).toHaveBeenCalledWith(sessionId);
    expect(runCommand).not.toHaveBeenCalled();

    // We expect it NOT to enqueue because it returns early
    expect(taskScheduler['queue'].length).toBe(0);
  });

  it('interrupts execution and batches pending tasks when action is interrupt', async () => {
    const sessionId = 'test-interrupt-batch';
    taskScheduler.abortTasks(sessionId);
    const interruptSpy = vi.spyOn(taskScheduler, 'interruptTasks');

    // Block the queue with a running task so subsequent ones stay pending
    taskScheduler
      .schedule({
        id: randomUUID(),
        rootChatId: 'chat1',
        dirPath: 'dir1',
        sessionId,
        execute: async () => {
          await new Promise((r) => setTimeout(r, 500));
        },
      })
      .catch(() => {});

    // Enqueue some dummy tasks with payloads
    taskScheduler
      .schedule({
        id: randomUUID(),
        rootChatId: 'chat1',
        dirPath: 'dir1',
        sessionId,
        text: 'pending 1',
        execute: async () => {
          await new Promise((r) => setTimeout(r, 100));
        },
      })
      .catch(() => {});

    taskScheduler
      .schedule({
        id: randomUUID(),
        rootChatId: 'chat1',
        dirPath: 'dir1',
        sessionId,
        text: 'pending 2',
        execute: async () => {
          await new Promise((r) => setTimeout(r, 100));
        },
      })
      .catch(() => {});

    const state: RouterState = {
      message: 'new urgent task',
      messageId: 'mock-msg-id',
      chatId: 'chat1',
      action: 'interrupt',
      sessionId,
    };

    vi.mocked(runCommand).mockResolvedValue({ stdout: 'done', stderr: '', exitCode: 0 });

    await executeDirectMessage('chat1', state, undefined, '/test-interrupt-batch', true);

    expect(interruptSpy).toHaveBeenCalledWith(sessionId);

    // Verify that the new task enqueued contains the merged payload
    const newlyEnqueued = taskScheduler['queue'].find((t) => t.task.sessionId === sessionId);
    expect(newlyEnqueued).toBeDefined();
    expect(newlyEnqueued?.task.text).toBe(
      '<message>\npending 1\n</message>\n\n<message>\npending 2\n</message>\n\n<message>\nnew urgent task\n</message>'
    );
  });

  it('returns early when message is empty and no action is specified', async () => {
    const sessionId = 'test-interrupt-empty';
    taskScheduler.abortTasks(sessionId);

    const state: RouterState = {
      message: '   ',
      messageId: 'mock-msg-id',
      chatId: 'chat1',
      sessionId,
    };

    vi.mocked(runCommand).mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
    await executeDirectMessage('chat1', state, undefined, '/test-interrupt-empty', true);

    expect(runCommand).not.toHaveBeenCalled();
    const queuedForSession = taskScheduler['queue'].filter((t) => t.task.sessionId === sessionId);
    expect(queuedForSession.length).toBe(0);
  });
});
