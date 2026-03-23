/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleUserMessage } from './message.js';
import * as chats from './chats.js';
import { spawn } from 'node:child_process';
import { runCommandCallback, createMockSpawn } from './message-test-utils.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
vi.mock('./chats.js', () => ({ appendMessage: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./routers.js', () => ({
  executeRouterPipeline: vi.fn().mockImplementation((state) => Promise.resolve(state)),
}));
vi.mock('../shared/workspace.js', () => ({
  resolveAgentWorkDir: vi
    .fn()
    .mockImplementation((id, dir, root) => (dir ? `${root}/${dir}` : `${root}/${id}`)),

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

describe('Daemon Execution Queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs sequentially for the same directory', async () => {
    const mockSpawn = createMockSpawn();
    (spawn as any).mockImplementation(mockSpawn);

    const settings = { defaultAgent: { commands: { new: 'echo msg' } } };

    const p1 = handleUserMessage(
      'chat1',
      'msg1',
      settings as any,
      '/dir1',
      false,
      runCommandCallback
    );

    await new Promise((r) => setTimeout(r, 0));

    const emitter1 = (mockSpawn as any).lastEmitter;
    expect(mockSpawn).toHaveBeenCalledTimes(1);

    const p2 = handleUserMessage(
      'chat1',
      'msg2',
      settings as any,
      '/dir1',
      false,
      runCommandCallback
    );

    await new Promise((r) => setTimeout(r, 0));

    // spawn should still be 1 because p2 is queued
    expect(mockSpawn).toHaveBeenCalledTimes(1);

    // finish process 1
    emitter1.finish(0);
    await p1;

    // wait a tick for p2 to start
    await new Promise((r) => setTimeout(r, 0));

    expect(mockSpawn).toHaveBeenCalledTimes(2);
    const emitter2 = (mockSpawn as any).lastEmitter;

    emitter2.finish(0);
    await p2;

    expect(chats.appendMessage).toHaveBeenCalled();
  });

  it('runs concurrently for different directories', async () => {
    const mockSpawn = createMockSpawn();
    (spawn as any).mockImplementation(mockSpawn);

    const settings = { defaultAgent: { commands: { new: 'echo msg' } } };

    handleUserMessage('chat1', 'msg1', settings as any, '/dir1', false, runCommandCallback);
    await new Promise((r) => setTimeout(r, 0));
    expect(mockSpawn).toHaveBeenCalledTimes(1);

    handleUserMessage('chat1', 'msg2', settings as any, '/dir2', false, runCommandCallback);
    await new Promise((r) => setTimeout(r, 0));

    // Since it's a different directory, it should spawn immediately
    expect(mockSpawn).toHaveBeenCalledTimes(2);
  });

  it('records failure logs without halting the queue', async () => {
    const mockSpawn = createMockSpawn();
    (spawn as any).mockImplementation(mockSpawn);

    const settings = { defaultAgent: { commands: { new: 'echo msg' } } };

    const p1 = handleUserMessage(
      'chat1',
      'msg1',
      settings as any,
      '/dir-fail',
      false,
      runCommandCallback
    );
    await new Promise((r) => setTimeout(r, 0));

    const p2 = handleUserMessage(
      'chat1',
      'msg2',
      settings as any,
      '/dir-fail',
      false,
      runCommandCallback
    );

    const emitter1 = (mockSpawn as any).emitters[0];
    emitter1.fail(new Error('command not found'));
    await p1;

    expect(chats.appendMessage).toHaveBeenCalledWith(
      'chat1',
      expect.objectContaining({
        role: 'log',
        exitCode: 1,
        stderr: 'Error: command not found',
      })
    );

    await new Promise((r) => setTimeout(r, 0));

    expect(mockSpawn).toHaveBeenCalledTimes(2);
    const emitter2 = (mockSpawn as any).emitters[1];
    emitter2.finish(0);
    await p2;
  });
});
