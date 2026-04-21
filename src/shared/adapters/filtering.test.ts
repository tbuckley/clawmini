import { describe, it, expect } from 'vitest';
import { shouldDisplayMessage, routeMessage, formatMessage } from './filtering.js';
import type { ChatMessage } from '../chats.js';

describe('shouldDisplayMessage / routeMessage', () => {
  const defaultConfig = {};

  it('hides messages with subagentId if subagent is not explicitly true', () => {
    const msg: ChatMessage = {
      id: '1',
      role: 'agent',
      content: 'hello',
      subagentId: 'sub1',
      timestamp: '',
      sessionId: undefined,
    };
    expect(shouldDisplayMessage(msg, defaultConfig)).toBe(false);
    expect(routeMessage(msg, defaultConfig)).toEqual({ kind: 'drop' });
  });

  it('drops standard user messages without subagentId', () => {
    const msg: ChatMessage = {
      id: '1',
      role: 'user',
      content: 'hello',
      timestamp: '',
      sessionId: undefined,
    };
    expect(shouldDisplayMessage(msg, defaultConfig)).toBe(false);
    expect(routeMessage(msg, defaultConfig)).toEqual({ kind: 'drop' });
  });

  it('routes standard agent messages to top-level', () => {
    const msg: ChatMessage = {
      id: '1',
      role: 'agent',
      content: 'hello',
      timestamp: '',
      sessionId: undefined,
    };
    expect(routeMessage(msg, defaultConfig)).toEqual({ kind: 'top-level' });
  });

  it('routes command messages to thread-log by default', () => {
    const msg: ChatMessage = {
      id: '1',
      role: 'command',
      content: 'ls',
      messageId: '123',
      command: 'ls',
      cwd: '.',
      stdout: '',
      stderr: '',
      exitCode: 0,
      timestamp: '',
      sessionId: undefined,
    };
    expect(routeMessage(msg, defaultConfig)).toEqual({ kind: 'thread-log' });
    // Legacy boolean retains old "drop by default" semantics for Discord.
    expect(shouldDisplayMessage(msg, defaultConfig)).toBe(false);
  });

  it('routes tool messages to thread-log by default', () => {
    const msg: ChatMessage = {
      id: '1',
      role: 'tool',
      content: '',
      messageId: '123',
      name: 'Read',
      payload: {},
      timestamp: '',
      sessionId: undefined,
    };
    expect(routeMessage(msg, defaultConfig)).toEqual({ kind: 'thread-log' });
  });

  it('routes pending policy messages to thread-message', () => {
    const msg: ChatMessage = {
      id: '1',
      role: 'policy',
      content: '',
      messageId: '123',
      requestId: 'req',
      commandName: 'rm',
      args: [],
      status: 'pending',
      timestamp: '',
      sessionId: undefined,
    };
    expect(routeMessage(msg, defaultConfig)).toEqual({ kind: 'thread-message' });
  });

  it('displays subagent messages if subagent: true', () => {
    const msg: ChatMessage = {
      id: '1',
      role: 'agent',
      content: 'hello',
      subagentId: 'sub1',
      timestamp: '',
      sessionId: undefined,
    };
    expect(shouldDisplayMessage(msg, { filters: { subagent: true } })).toBe(true);
  });

  it('displays user messages with subagentId if subagent: true', () => {
    const msg: ChatMessage = {
      id: '2',
      role: 'user',
      content: 'hello subagent',
      subagentId: 'sub1',
      timestamp: '',
      sessionId: undefined,
    };
    expect(shouldDisplayMessage(msg, { filters: { subagent: true } })).toBe(true);
  });

  it('displays specific role if explicitly allowed', () => {
    const msg: ChatMessage = {
      id: '1',
      role: 'command',
      content: 'ls',
      messageId: '123',
      command: 'ls',
      cwd: '.',
      stdout: '',
      stderr: '',
      exitCode: 0,
      timestamp: '',
      sessionId: undefined,
    };
    expect(shouldDisplayMessage(msg, { filters: { command: true } })).toBe(true);
  });

  it('hides a role when filter is explicitly false', () => {
    const msg: ChatMessage = {
      id: '1',
      role: 'command',
      content: 'ls',
      messageId: '123',
      command: 'ls',
      cwd: '.',
      stdout: '',
      stderr: '',
      exitCode: 0,
      timestamp: '',
      sessionId: undefined,
    };
    expect(shouldDisplayMessage(msg, { filters: { command: false } })).toBe(false);
  });

  it('promotes a user-role message to top-level when filter is true', () => {
    const msg: ChatMessage = {
      id: '1',
      role: 'user',
      content: 'hello',
      timestamp: '',
      sessionId: undefined,
    };
    expect(routeMessage(msg, { filters: { user: true } })).toEqual({ kind: 'top-level' });
  });
});

describe('formatMessage', () => {
  it('returns content as-is for messages without subagentId', () => {
    const msg: ChatMessage = {
      id: '1',
      role: 'agent',
      content: 'hello world',
      timestamp: '',
      sessionId: undefined,
    };
    expect(formatMessage(msg)).toBe('hello world');
  });

  it('prepends [To:<id>] for user messages to subagents', () => {
    const msg: ChatMessage = {
      id: '1',
      role: 'user',
      content: 'do task',
      subagentId: 'sub1',
      timestamp: '',
      sessionId: undefined,
    };
    expect(formatMessage(msg)).toBe('[To:sub1]\ndo task');
  });

  it('prepends [From:<id>] for agent messages from subagents', () => {
    const msg: ChatMessage = {
      id: '1',
      role: 'agent',
      content: 'done',
      subagentId: 'sub1',
      timestamp: '',
      sessionId: undefined,
    };
    expect(formatMessage(msg)).toBe('[From:sub1]\ndone');
  });
});
