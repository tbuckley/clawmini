import { describe, it, expect } from 'vitest';
import { shouldDisplayMessage, formatMessage } from './filtering.js';
import type { ChatMessage } from '../chats.js';

describe('shouldDisplayMessage', () => {
  const defaultConfig = {};

  it('hides messages with subagentId if subagent is not explicitly true', () => {
    const msg: ChatMessage = {
      id: '1',
      role: 'agent',
      content: 'hello',
      subagentId: 'sub1',
      timestamp: '',
    };
    expect(shouldDisplayMessage(msg, defaultConfig)).toBe(false);
  });

  it('hides standard user messages without subagentId', () => {
    const msg: ChatMessage = { id: '1', role: 'user', content: 'hello', timestamp: '' };
    expect(shouldDisplayMessage(msg, defaultConfig)).toBe(false);
  });

  it('displays standard agent messages without subagentId', () => {
    const msg: ChatMessage = { id: '1', role: 'agent', content: 'hello', timestamp: '' };
    expect(shouldDisplayMessage(msg, defaultConfig)).toBe(true);
  });

  it('hides non-standard messages by default', () => {
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
    };
    expect(shouldDisplayMessage(msg, defaultConfig)).toBe(false);
  });

  it('displays subagent messages if subagent: true', () => {
    const msg: ChatMessage = {
      id: '1',
      role: 'agent',
      content: 'hello',
      subagentId: 'sub1',
      timestamp: '',
    };
    expect(shouldDisplayMessage(msg, { messages: { subagent: true } })).toBe(true);
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
    };
    expect(shouldDisplayMessage(msg, { messages: { command: true } })).toBe(true);
  });
});

describe('formatMessage', () => {
  it('returns content as-is for messages without subagentId', () => {
    const msg: ChatMessage = { id: '1', role: 'agent', content: 'hello world', timestamp: '' };
    expect(formatMessage(msg)).toBe('hello world');
  });

  it('prepends [To:<id>] for user messages to subagents', () => {
    const msg: ChatMessage = {
      id: '1',
      role: 'user',
      content: 'do task',
      subagentId: 'sub1',
      timestamp: '',
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
    };
    expect(formatMessage(msg)).toBe('[From:sub1]\ndone');
  });
});
