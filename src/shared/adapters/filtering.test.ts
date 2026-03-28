import { describe, it, expect } from 'vitest';
import { shouldDisplayMessage, formatMessage } from './filtering.js';
import type { ChatMessage } from '../chats.js';

describe('shouldDisplayMessage', () => {
  const defaultConfig = {};

  it('displays default agent messages without subagentId', () => {
    const msg: ChatMessage = { id: '1', role: 'agent', content: 'hello', timestamp: '' };
    expect(shouldDisplayMessage(msg, defaultConfig)).toBe(true);
  });

  it('displays legacy_log messages without subagentId', () => {
    const msg: ChatMessage = { id: '1', role: 'legacy_log', content: 'hello', timestamp: '' };
    expect(shouldDisplayMessage(msg, defaultConfig)).toBe(true);
  });

  it('hides default agent messages with subagentId by default', () => {
    const msg: ChatMessage = {
      id: '1',
      role: 'agent',
      content: 'hello',
      subagentId: 'sub1',
      timestamp: '',
    };
    expect(shouldDisplayMessage(msg, defaultConfig)).toBe(false);
  });

  it('hides non-agent messages by default', () => {
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

  it('displays anything if all: true', () => {
    const msg: ChatMessage = {
      id: '1',
      role: 'tool',
      content: 'hello',
      messageId: '123',
      name: 'tool1',
      payload: {},
      timestamp: '',
    };
    expect(shouldDisplayMessage(msg, { messages: { all: true } })).toBe(true);
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

  it('displays specific role if overridden', () => {
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

  it('hides explicitly disabled roles even if they match default rules', () => {
    const msg: ChatMessage = { id: '1', role: 'agent', content: 'hello', timestamp: '' };
    expect(shouldDisplayMessage(msg, { messages: { agent: false } })).toBe(false);
  });

  it('hides subagent if subagent explicitly false, even if role is explicitly true', () => {
    const msg: ChatMessage = {
      id: '1',
      role: 'agent',
      content: 'hello',
      subagentId: 'sub1',
      timestamp: '',
    };
    expect(shouldDisplayMessage(msg, { messages: { agent: true, subagent: false } })).toBe(false);
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
