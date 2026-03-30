/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleUserMessage } from './message.js';
import * as workspace from '../shared/workspace.js';
import * as chats from './chats.js';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
vi.mock('./chats.js', () => ({ appendMessage: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./routers.js', () => ({
  resolveRouters: vi.fn((routers) => routers),
  executeRouterPipeline: vi.fn().mockImplementation((state) => Promise.resolve(state)),
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

describe('Extraction Logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('spawns getSessionId on a new session, parses output, and updates state files', async () => {
    const mockSpawn = vi.fn().mockImplementation((cmd) => {
      const emitter = new EventEmitter() as any;
      emitter.stdout = new EventEmitter();
      emitter.stderr = new EventEmitter();
      emitter.stdin = { write: vi.fn(), end: vi.fn(), on: vi.fn() };
      emitter.finish = (code: number) => {
        emitter.emit('close', code);
      };

      setTimeout(() => {
        if (cmd === 'echo main') {
          emitter.stdout.emit('data', 'main_output');
          emitter.finish(0);
        } else if (cmd === 'echo getSessionId') {
          emitter.stdout.emit('data', 'new-session-id-123\n');
          emitter.finish(0);
        } else {
          emitter.finish(0);
        }
      }, 0);

      return emitter;
    });
    (spawn as any).mockImplementation(mockSpawn);

    vi.mocked(workspace.readChatSettings).mockResolvedValue({ defaultAgent: 'my-agent' });
    vi.mocked(workspace.readAgentSessionSettings).mockResolvedValue(null); // new session

    const settings = {
      defaultAgent: {
        commands: {
          new: 'echo main',
          getSessionId: 'echo getSessionId',
        },
      },
    };

    await handleUserMessage('chat1', 'hello', settings as any, '/dir-extract-1', false);

    // Verify spawn was called twice
    expect(mockSpawn).toHaveBeenCalledTimes(2);
    expect(mockSpawn).toHaveBeenNthCalledWith(1, 'echo main', expect.anything());
    // The second call is getSessionId, and its stdin should have been piped in the callback
    expect(mockSpawn).toHaveBeenNthCalledWith(2, 'echo getSessionId', expect.anything());

    // Verify state files were updated
    expect(workspace.writeAgentSessionSettings).toHaveBeenCalledWith(
      'my-agent',
      'default',
      { env: { SESSION_ID: 'new-session-id-123' } },
      '/dir-extract-1'
    );
  });

  it('spawns getMessageContent, piping main stdout', async () => {
    const mockSpawn = vi.fn().mockImplementation((cmd) => {
      const emitter = new EventEmitter() as any;
      emitter.stdout = new EventEmitter();
      emitter.stderr = new EventEmitter();
      emitter.stdin = { write: vi.fn(), end: vi.fn(), on: vi.fn() };
      emitter.finish = (code: number) => {
        emitter.emit('close', code);
      };

      setTimeout(() => {
        if (cmd === 'echo main') {
          emitter.stdout.emit('data', 'main_output');
          emitter.finish(0);
        } else if (cmd === 'echo getMessageContent') {
          emitter.stdout.emit('data', 'extracted message content');
          emitter.finish(0);
        } else {
          emitter.finish(0);
        }
      }, 0);

      return emitter;
    });
    (spawn as any).mockImplementation(mockSpawn);

    vi.mocked(workspace.readChatSettings).mockResolvedValue(null);
    // Not a new session
    vi.mocked(workspace.readAgentSessionSettings).mockResolvedValue({ env: {} });

    const settings = {
      defaultAgent: {
        commands: {
          new: 'echo main',
          append: 'echo main',
          getMessageContent: 'echo getMessageContent',
        },
      },
    };

    await handleUserMessage('chat1', 'hello', settings as any, '/dir-extract-2', false);

    expect(mockSpawn).toHaveBeenCalledTimes(2);
    expect(mockSpawn).toHaveBeenNthCalledWith(2, 'echo getMessageContent', expect.anything());

    // Extraction success doesn't update state files (except log, which is tested via Chats mock)
    expect(chats.appendMessage).toHaveBeenCalledWith(
      'chat1',
      expect.objectContaining({
        role: 'command',
        content: 'extracted message content',
        stdout: 'main_output',
      })
    );
  });
});
