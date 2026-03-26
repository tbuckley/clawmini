import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { subagentWait } from './subagent-router.js';
import { daemonEvents, DAEMON_EVENT_MESSAGE_APPENDED } from '../events.js';
import * as workspace from '../../shared/workspace.js';
import * as chats from '../../shared/chats.js';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

vi.mock('../../shared/workspace.js', () => ({
  readChatSettings: vi.fn(),
  updateChatSettings: vi.fn(),
  getWorkspaceRoot: vi.fn().mockReturnValue('/mock/root'),
}));

vi.mock('../agent/chat-logger.js', () => ({
  createChatLogger: vi.fn(() => ({
    findLastMessage: vi.fn().mockResolvedValue({ role: 'log', content: 'Mock output' })
  }))
}));

describe('subagentWait', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    daemonEvents.removeAllListeners();
  });

  it('should not miss events if subagent completes immediately after checkSubagentStatus starts', async () => {
    // We simulate checkSubagentStatus taking some time (e.g. reading from disk).
    // While it is awaiting, an event is emitted indicating completion.
    // The wait procedure should still catch the completion.

    const subagentId = 'sub-1';
    const chatId = 'chat-1';

    let firstCall = true;

    vi.mocked(workspace.readChatSettings).mockImplementation(async (id: string) => {
      if (firstCall) {
        firstCall = false;
        // Emit the event while the first check is "in flight"
        // This simulates the race condition where the status is "active" at the exact moment
        // of reading, but changes immediately after before the event listener would be bound in the buggy code.
        setTimeout(() => {
          daemonEvents.emit(DAEMON_EVENT_MESSAGE_APPENDED, {
            chatId,
            message: { role: 'log', content: 'Subagent completed', subagentId }
          });
        }, 10);
        
        await new Promise(r => setTimeout(r, 50));
        return {
          subagents: {
            [subagentId]: { status: 'active', id: subagentId }
          }
        };
      } else {
        return {
          subagents: {
            [subagentId]: { status: 'completed', id: subagentId }
          }
        };
      }
    });

    const ctx = {
      tokenPayload: { chatId, agentId: 'agent', sessionId: 'session' }
    };

    const caller = subagentWait._def.query ? subagentWait._def.query : subagentWait;
    
    // We need to call the procedure's resolve function or use createCaller.
    // We'll directly invoke it as an internal test.
    const resultPromise = subagentWait({
      ctx,
      input: { subagentId },
      path: 'subagentWait',
      type: 'mutation',
      rawInput: { subagentId },
      meta: undefined,
      next: vi.fn(),
      getRawInput: async () => ({ subagentId })
    });

    // We don't want the test to hang if the bug is present, so we use Promise.race
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout - event missed')), 500));
    
    const result = await Promise.race([resultPromise, timeoutPromise]);
    expect(result).toEqual({ status: 'completed', output: 'Mock output' });
  });
});
