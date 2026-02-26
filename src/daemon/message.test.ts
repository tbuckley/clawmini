/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleUserMessage } from './message.js';
import * as chats from '../shared/chats.js';
import * as workspace from '../shared/workspace.js';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';

vi.mock('../shared/chats.js', () => ({
  appendMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../shared/workspace.js', () => ({
  readChatSettings: vi.fn().mockResolvedValue(null),
  writeChatSettings: vi.fn().mockResolvedValue(undefined),
  readAgentSessionSettings: vi.fn().mockResolvedValue(null),
  writeAgentSessionSettings: vi.fn().mockResolvedValue(undefined),
  getAgent: vi.fn().mockResolvedValue(null),
  getWorkspaceRoot: vi.fn().mockImplementation((cwd) => cwd),
}));

vi.mock('node:child_process', () => {
  return {
    spawn: vi.fn(),
  };
});

describe('Daemon Execution Queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const runCommandCallback = async ({ command, cwd, env, stdin }: any) => {
    return new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve) => {
      const p = spawn(command, { shell: true, cwd, env });
      if (stdin) {
        if (p.stdin) {
          p.stdin.write(stdin);
          p.stdin.end();
        }
      }
      let stdout = '';
      let stderr = '';
      if (p.stdout) p.stdout.on('data', (data: any) => (stdout += data.toString()));
      if (p.stderr) p.stderr.on('data', (data: any) => (stderr += data.toString()));
      p.on('close', (code: any) => resolve({ stdout, stderr, exitCode: code ?? 1 }));
      p.on('error', (err: any) => resolve({ stdout: '', stderr: err.toString(), exitCode: 1 }));
    });
  };

  it('runs sequentially for the same directory', async () => {
    const mockSpawn = vi.fn().mockImplementation((_cmd, _options) => {
      const emitter = new EventEmitter() as any;
      emitter.stdout = new EventEmitter();
      emitter.stderr = new EventEmitter();
      emitter.stdin = { write: vi.fn(), end: vi.fn() };

      emitter.finish = (code: number) => {
        emitter.emit('close', code);
      };

      (mockSpawn as any).lastEmitter = emitter;
      return emitter;
    });

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
    const mockSpawn = vi.fn().mockImplementation((_cmd, _options) => {
      const emitter = new EventEmitter() as any;
      emitter.stdout = new EventEmitter();
      emitter.stderr = new EventEmitter();
      emitter.stdin = { write: vi.fn(), end: vi.fn() };
      emitter.finish = (code: number) => {
        emitter.emit('close', code);
      };
      return emitter;
    });

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
    const mockSpawn = vi.fn().mockImplementation((_cmd, _options) => {
      const emitter = new EventEmitter() as any;
      emitter.stdout = new EventEmitter();
      emitter.stderr = new EventEmitter();
      emitter.stdin = { write: vi.fn(), end: vi.fn() };
      emitter.finish = (code: number) => {
        emitter.emit('close', code);
      };
      emitter.fail = (err: Error) => {
        emitter.emit('error', err);
      };

      (mockSpawn as any).emitters = (mockSpawn as any).emitters || [];
      (mockSpawn as any).emitters.push(emitter);
      return emitter;
    });

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

  describe('Session Resolution & Execution', () => {
    it('executes commands.new if session state file does not exist', async () => {
      const mockSpawn = vi.fn().mockImplementation(() => {
        const emitter = new EventEmitter() as any;
        emitter.stdout = new EventEmitter();
        emitter.stderr = new EventEmitter();
        emitter.stdin = { write: vi.fn(), end: vi.fn() };
        emitter.finish = (code: number) => emitter.emit('close', code);
        setTimeout(() => emitter.finish(0), 0);
        return emitter;
      });
      (spawn as any).mockImplementation(mockSpawn);

      vi.mocked(workspace.readChatSettings).mockResolvedValue(null);
      vi.mocked(workspace.readAgentSessionSettings).mockResolvedValue(null);

      const settings = { defaultAgent: { commands: { new: 'echo new', append: 'echo append' } } };

      await handleUserMessage(
        'chat1',
        'hello',
        settings as any,
        '/dir-sess-1',
        false,
        runCommandCallback,
        'my-session'
      );

      expect(workspace.readChatSettings).toHaveBeenCalledWith('chat1', '/dir-sess-1');
      expect(workspace.readAgentSessionSettings).toHaveBeenCalledWith(
        'default',
        'my-session',
        '/dir-sess-1'
      );
      expect(mockSpawn).toHaveBeenCalledWith(
        'echo new',
        expect.objectContaining({ cwd: '/dir-sess-1' })
      );
    });

    it('executes commands.append if session state file exists and injects environment', async () => {
      const mockSpawn = vi.fn().mockImplementation(() => {
        const emitter = new EventEmitter() as any;
        emitter.stdout = new EventEmitter();
        emitter.stderr = new EventEmitter();
        emitter.stdin = { write: vi.fn(), end: vi.fn() };
        emitter.finish = (code: number) => emitter.emit('close', code);
        setTimeout(() => emitter.finish(0), 0);
        return emitter;
      });
      (spawn as any).mockImplementation(mockSpawn);

      vi.mocked(workspace.readChatSettings).mockResolvedValue({
        defaultAgent: 'my-agent',
        sessions: { 'my-agent': 'chat-session' },
      });
      vi.mocked(workspace.readAgentSessionSettings).mockResolvedValue({
        env: { SESSION_ID: '12345' },
      });

      const settings = { defaultAgent: { commands: { new: 'echo new', append: 'echo append' } } };

      await handleUserMessage(
        'chat1',
        'hello',
        settings as any,
        '/dir-sess-3',
        false,
        runCommandCallback
      );

      // Should use inferred session from chatSettings
      expect(workspace.readAgentSessionSettings).toHaveBeenCalledWith(
        'my-agent',
        'chat-session',
        '/dir-sess-3'
      );

      // Should have called spawn with `echo append`
      expect(mockSpawn).toHaveBeenCalledWith(
        'echo append',
        expect.objectContaining({
          env: expect.objectContaining({
            SESSION_ID: '12345',
            CLAW_CLI_MESSAGE: 'hello',
          }),
        })
      );
    });

    it('falls back to commands.new if session exists but commands.append is undefined', async () => {
      const mockSpawn = vi.fn().mockImplementation(() => {
        const emitter = new EventEmitter() as any;
        emitter.stdout = new EventEmitter();
        emitter.stderr = new EventEmitter();
        emitter.stdin = { write: vi.fn(), end: vi.fn() };
        emitter.finish = (code: number) => emitter.emit('close', code);
        setTimeout(() => emitter.finish(0), 0);
        return emitter;
      });
      (spawn as any).mockImplementation(mockSpawn);

      vi.mocked(workspace.readChatSettings).mockResolvedValue(null);
      vi.mocked(workspace.readAgentSessionSettings).mockResolvedValue({
        env: { SESSION_ID: '12345' },
      });

      const settings = { defaultAgent: { commands: { new: 'echo new' } } };

      await handleUserMessage(
        'chat1',
        'hello',
        settings as any,
        '/dir-sess-2',
        false,
        runCommandCallback,
        'my-session'
      );

      expect(mockSpawn).toHaveBeenCalledWith('echo new', expect.anything());
    });
  });

  describe('Extraction Logic', () => {
    it('spawns getSessionId on a new session, parses output, and updates state files', async () => {
      const mockSpawn = vi.fn().mockImplementation((cmd) => {
        const emitter = new EventEmitter() as any;
        emitter.stdout = new EventEmitter();
        emitter.stderr = new EventEmitter();
        emitter.stdin = { write: vi.fn(), end: vi.fn() };
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

      await handleUserMessage(
        'chat1',
        'hello',
        settings as any,
        '/dir-extract-1',
        false,
        runCommandCallback
      );

      // Verify spawn was called twice
      expect(mockSpawn).toHaveBeenCalledTimes(2);
      expect(mockSpawn).toHaveBeenNthCalledWith(1, 'echo main', expect.anything());
      // The second call is getSessionId, and its stdin should have been piped in the callback
      expect(mockSpawn).toHaveBeenNthCalledWith(2, 'echo getSessionId', expect.anything());

      // Verify state files were updated
      expect(workspace.writeChatSettings).toHaveBeenCalledWith(
        'chat1',
        expect.objectContaining({
          defaultAgent: 'my-agent',
          sessions: { 'my-agent': 'new-session-id-123' },
        }),
        '/dir-extract-1'
      );

      expect(workspace.writeAgentSessionSettings).toHaveBeenCalledWith(
        'my-agent',
        'new-session-id-123',
        { env: { SESSION_ID: 'new-session-id-123' } },
        '/dir-extract-1'
      );
    });

    it('spawns getMessageContent, piping main stdout', async () => {
      const mockSpawn = vi.fn().mockImplementation((cmd) => {
        const emitter = new EventEmitter() as any;
        emitter.stdout = new EventEmitter();
        emitter.stderr = new EventEmitter();
        emitter.stdin = { write: vi.fn(), end: vi.fn() };
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

      await handleUserMessage(
        'chat1',
        'hello',
        settings as any,
        '/dir-extract-2',
        false,
        runCommandCallback
      );

      expect(mockSpawn).toHaveBeenCalledTimes(2);
      expect(mockSpawn).toHaveBeenNthCalledWith(2, 'echo getMessageContent', expect.anything());

      // Extraction success doesn't update state files (except log, which is tested via Chats mock)
      expect(chats.appendMessage).toHaveBeenCalledWith(
        'chat1',
        expect.objectContaining({
          role: 'log',
          content: 'extracted message content',
          stdout: 'main_output',
        })
      );
    });
  });

  describe('Agent Configuration & Execution CWD', () => {
    it('merges custom agent settings over defaultAgent', async () => {
      const mockSpawn = vi.fn().mockImplementation(() => {
        const emitter = new EventEmitter() as any;
        emitter.stdout = new EventEmitter();
        emitter.stderr = new EventEmitter();
        emitter.stdin = { write: vi.fn(), end: vi.fn() };
        emitter.finish = (code: number) => emitter.emit('close', code);
        setTimeout(() => emitter.finish(0), 0);
        return emitter;
      });
      (spawn as any).mockImplementation(mockSpawn);

      vi.mocked(workspace.readChatSettings).mockResolvedValue({ defaultAgent: 'custom-agent' });
      vi.mocked(workspace.readAgentSessionSettings).mockResolvedValue(null);
      vi.mocked(workspace.getAgent).mockResolvedValue({
        commands: {
          new: 'echo custom',
        },
        env: {
          CUSTOM_VAR: 'yes',
        },
      });

      const settings = {
        defaultAgent: {
          commands: { new: 'echo main', append: 'echo append' },
          env: { DEFAULT_VAR: 'yes' },
        },
      };

      await handleUserMessage(
        'chat-custom',
        'hello',
        settings as any,
        '/dir',
        false,
        runCommandCallback
      );

      expect(workspace.getAgent).toHaveBeenCalledWith('custom-agent', '/dir');
      expect(mockSpawn).toHaveBeenCalledWith(
        'echo custom',
        expect.objectContaining({
          env: expect.objectContaining({
            DEFAULT_VAR: 'yes',
            CUSTOM_VAR: 'yes',
          }),
        })
      );
    });

    it('resolves cwd based on custom agent name if directory is not provided', async () => {
      const mockSpawn = vi.fn().mockImplementation(() => {
        const emitter = new EventEmitter() as any;
        emitter.stdout = new EventEmitter();
        emitter.stderr = new EventEmitter();
        emitter.stdin = { write: vi.fn(), end: vi.fn() };
        emitter.finish = (code: number) => emitter.emit('close', code);
        setTimeout(() => emitter.finish(0), 0);
        return emitter;
      });
      (spawn as any).mockImplementation(mockSpawn);

      vi.mocked(workspace.readChatSettings).mockResolvedValue({ defaultAgent: 'some-agent' });
      vi.mocked(workspace.getAgent).mockResolvedValue({
        commands: { new: 'echo agent-dir' },
      });
      vi.mocked(workspace.getWorkspaceRoot).mockReturnValue('/base/workspace');

      const settings = { defaultAgent: { commands: { new: 'echo main' } } };

      await handleUserMessage(
        'chat-dir-1',
        'hi',
        settings as any,
        '/base/workspace',
        false,
        runCommandCallback
      );

      expect(mockSpawn).toHaveBeenCalledWith(
        'echo agent-dir',
        expect.objectContaining({
          cwd: '/base/workspace/some-agent',
        })
      );
    });

    it('resolves cwd based on agent directory property if provided', async () => {
      const mockSpawn = vi.fn().mockImplementation(() => {
        const emitter = new EventEmitter() as any;
        emitter.stdout = new EventEmitter();
        emitter.stderr = new EventEmitter();
        emitter.stdin = { write: vi.fn(), end: vi.fn() };
        emitter.finish = (code: number) => emitter.emit('close', code);
        setTimeout(() => emitter.finish(0), 0);
        return emitter;
      });
      (spawn as any).mockImplementation(mockSpawn);

      vi.mocked(workspace.readChatSettings).mockResolvedValue({ defaultAgent: 'custom-dir-agent' });
      vi.mocked(workspace.getAgent).mockResolvedValue({
        directory: 'src/custom-path',
        commands: { new: 'echo my-dir' },
      });
      vi.mocked(workspace.getWorkspaceRoot).mockReturnValue('/base/workspace');

      const settings = { defaultAgent: { commands: { new: 'echo main' } } };

      await handleUserMessage(
        'chat-dir-2',
        'hi',
        settings as any,
        '/base/workspace',
        false,
        runCommandCallback
      );

      expect(mockSpawn).toHaveBeenCalledWith(
        'echo my-dir',
        expect.objectContaining({
          cwd: '/base/workspace/src/custom-path',
        })
      );
    });
  });
});
