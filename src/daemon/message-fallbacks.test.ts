/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleUserMessage, calculateDelay } from './message.js';
import { spawn } from 'node:child_process';
import * as chats from '../shared/chats.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
vi.mock('../shared/chats.js', () => ({ appendMessage: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./routers.js', () => ({
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

describe('calculateDelay', () => {
  const baseDelay = 1000;

  it('returns 0 for attempt 0', () => {
    expect(calculateDelay(0, baseDelay)).toBe(0);
  });

  it('returns baseDelay for attempt 0 on fallback', () => {
    expect(calculateDelay(0, baseDelay, true)).toBe(baseDelay);
  });

  it('returns baseDelay for attempt 1', () => {
    expect(calculateDelay(1, baseDelay)).toBe(baseDelay);
  });

  it('doubles delay for attempt 2', () => {
    expect(calculateDelay(2, baseDelay)).toBe(2000);
  });

  it('doubles delay for attempt 3', () => {
    expect(calculateDelay(3, baseDelay)).toBe(4000);
  });

  it('doubles delay for attempt 4', () => {
    expect(calculateDelay(4, baseDelay)).toBe(8000);
  });

  it('caps delay at 15000ms', () => {
    expect(calculateDelay(5, baseDelay)).toBe(15000);
    expect(calculateDelay(10, baseDelay)).toBe(15000);
  });

  it('respects a different baseDelay', () => {
    const customBase = 500;
    expect(calculateDelay(1, customBase)).toBe(500);
    expect(calculateDelay(2, customBase)).toBe(1000);
    expect(calculateDelay(6, customBase)).toBe(15000); // 500 * 2^5 = 16000, capped at 15000
  });
});

describe('Message Fallbacks & Retries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retries when base attempt fails (exit code 1) and succeeds on fallback', async () => {
    let callCount = 0;
    const mockSpawn = vi.fn().mockImplementation((_cmd, _options) => {
      callCount++;
      const emitter: any = {
        on: vi.fn((event, cb) => {
          if (event === 'close') {
            // First call fails, second call succeeds
            cb(callCount === 1 ? 1 : 0);
          }
          return emitter;
        }),
        stdout: {
          on: vi.fn((event, cb) => {
            if (event === 'data') cb(Buffer.from(`output ${callCount}`));
            return emitter;
          }),
        },
        stderr: {
          on: vi.fn((event, cb) => {
            if (event === 'data' && callCount === 1) cb(Buffer.from('error'));
            return emitter;
          }),
        },
      };
      return emitter;
    });
    (spawn as any).mockImplementation(mockSpawn);

    const settings = {
      defaultAgent: {
        commands: { new: 'echo base' },
        fallbacks: [
          {
            commands: { new: 'echo fallback' },
            retries: 0,
          },
        ],
      },
    };

    await handleUserMessage('chat-fallback', 'hello', settings as any, '/dir', false);

    // Should call base once, then fallback once
    expect(mockSpawn).toHaveBeenCalledTimes(2);
    expect(mockSpawn).toHaveBeenNthCalledWith(1, 'echo base', expect.anything());
    expect(mockSpawn).toHaveBeenNthCalledWith(2, 'echo fallback', expect.anything());

    // Should append the successful log message
    expect(chats.appendMessage).toHaveBeenCalledWith(
      'chat-fallback',
      expect.objectContaining({
        role: 'log',
        content: 'output 2',
        exitCode: 0,
      }),
      expect.any(String)
    );
  });

  it('retries when getMessageContent returns empty string', async () => {
    let callCount = 0;
    const mockSpawn = vi.fn().mockImplementation((cmd, _options) => {
      callCount++;
      // cmd can be 'echo base', 'extract', or 'echo fallback'
      // We want to return empty string for 'extract' when it's called after 'echo base'
      let output = `output ${callCount}`;
      if (cmd === 'extract' && callCount === 2) {
        output = '';
      }

      const emitter: any = {
        on: vi.fn((event, cb) => {
          if (event === 'close') cb(0);
          return emitter;
        }),
        stdout: {
          on: vi.fn((event, cb) => {
            if (event === 'data') cb(Buffer.from(output));
            return emitter;
          }),
        },
        stderr: { on: vi.fn() },
      };
      return emitter;
    });
    (spawn as any).mockImplementation(mockSpawn);

    const settings = {
      defaultAgent: {
        commands: { new: 'echo base', getMessageContent: 'extract' },
        fallbacks: [
          {
            commands: { new: 'echo fallback' },
            retries: 0,
          },
        ],
      },
    };

    await handleUserMessage('chat-empty', 'hello', settings as any, '/dir', false);

    // Call 1: base (success)
    // Call 2: getMessageContent (returns empty -> failure)
    // Call 3: fallback (success)
    // Call 4: getMessageContent for fallback (success)
    expect(mockSpawn).toHaveBeenCalledTimes(4);
    expect(mockSpawn).toHaveBeenNthCalledWith(1, 'echo base', expect.anything());
    expect(mockSpawn).toHaveBeenNthCalledWith(2, 'extract', expect.anything());
    expect(mockSpawn).toHaveBeenNthCalledWith(3, 'echo fallback', expect.anything());
    expect(mockSpawn).toHaveBeenNthCalledWith(4, 'extract', expect.anything());
  });

  it('supports multiple retries for a single fallback', async () => {
    let callCount = 0;
    const mockSpawn = vi.fn().mockImplementation((_cmd, _options) => {
      callCount++;
      const emitter: any = {
        on: vi.fn((event, cb) => {
          if (event === 'close') {
            // Call 1 (base) fails
            // Call 2 (fallback attempt 0) fails
            // Call 3 (fallback attempt 1) succeeds
            cb(callCount < 3 ? 1 : 0);
          }
          return emitter;
        }),
        stdout: {
          on: vi.fn((event, cb) => {
            if (event === 'data') cb(Buffer.from(`output ${callCount}`));
            return emitter;
          }),
        },
        stderr: { on: vi.fn() },
      };
      return emitter;
    });
    (spawn as any).mockImplementation(mockSpawn);

    const settings = {
      defaultAgent: {
        commands: { new: 'echo base' },
        fallbacks: [
          {
            commands: { new: 'echo fallback' },
            retries: 2,
          },
        ],
      },
    };

    await handleUserMessage('chat-retries', 'hello', settings as any, '/dir', false);

    // Call 1: base (fail)
    // Call 2: fallback attempt 0 (fail)
    // Call 3: fallback attempt 1 (success)
    expect(mockSpawn).toHaveBeenCalledTimes(3);
    expect(mockSpawn).toHaveBeenNthCalledWith(1, 'echo base', expect.anything());
    expect(mockSpawn).toHaveBeenNthCalledWith(2, 'echo fallback', expect.anything());
    expect(mockSpawn).toHaveBeenNthCalledWith(3, 'echo fallback', expect.anything());
  });

  it('appends a log message before waiting for retry delay', async () => {
    let callCount = 0;
    const mockSpawn = vi.fn().mockImplementation((_cmd, _options) => {
      callCount++;
      const emitter: any = {
        on: vi.fn((event, cb) => {
          if (event === 'close') {
            // Call 1 (base) fails
            // Call 2 (fallback attempt 0) fails
            // Call 3 (fallback attempt 1) succeeds
            cb(callCount < 3 ? 1 : 0);
          }
          return emitter;
        }),
        stdout: {
          on: vi.fn((event, cb) => {
            if (event === 'data') cb(Buffer.from('output'));
            return emitter;
          }),
        },
        stderr: { on: vi.fn() },
      };
      return emitter;
    });
    (spawn as any).mockImplementation(mockSpawn);

    const settings = {
      defaultAgent: {
        commands: { new: 'echo base' },
        fallbacks: [
          {
            commands: { new: 'echo fallback' },
            retries: 1,
            delayMs: 1000,
          },
        ],
      },
    };

    await handleUserMessage('chat-log-retry', 'hello', settings as any, '/dir', false);

    // Should find the retry log message
    expect(chats.appendMessage).toHaveBeenCalledWith(
      'chat-log-retry',
      expect.objectContaining({
        role: 'log',
        content: 'Error running agent, retrying in 1 seconds...',
        command: 'retry-delay',
      }),
      expect.any(String)
    );
  });
});
