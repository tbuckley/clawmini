import { page } from 'vitest/browser';
import { describe, expect, it, afterEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ChatPage from './+page.svelte';
import type { ChatMessage } from '$lib/types';
import { appState } from '$lib/app-state.svelte.js';

const mockData = {
  id: 'test-chat',
  chats: [],
  agents: [],
  messages: [
    {
      id: 'msg-1',
      role: 'user',
      content: 'Hello daemon',
      timestamp: new Date().toISOString(),
    },
    {
      id: 'log-1',
      messageId: 'msg-1',
      role: 'legacy_log',
      content: 'I am the daemon',
      command: 'echo "I am the daemon"',
      cwd: '/tmp',
      exitCode: 0,
      stdout: 'I am the daemon',
      stderr: '',
      timestamp: new Date().toISOString(),
      level: 'default',
    },
    {
      id: 'log-2',
      messageId: 'msg-1',
      role: 'legacy_log',
      content: 'Debug message',
      command: 'debug-cmd',
      cwd: '/tmp',
      exitCode: 0,
      stdout: 'debug out',
      stderr: '',
      timestamp: new Date().toISOString(),
      level: 'debug',
    },
    {
      id: 'log-3',
      messageId: 'msg-1',
      role: 'legacy_log',
      content: '',
      command: 'exit 1',
      cwd: '/tmp',
      exitCode: 1,
      stdout: '',
      stderr: 'Command failed',
      timestamp: new Date().toISOString(),
      level: 'verbose',
    },
    {
      id: 'agent-1',
      role: 'agent',
      content: 'I am a new agent message',
      timestamp: new Date().toISOString(),
    },
    {
      id: 'cmd-1',
      messageId: 'msg-1',
      role: 'command',
      content: '',
      command: 'ls',
      cwd: '/',
      exitCode: 0,
      stdout: 'files',
      stderr: '',
      timestamp: new Date().toISOString(),
    },
    {
      id: 'policy-1',
      messageId: 'msg-1',
      role: 'policy',
      requestId: 'req-1',
      commandName: 'rm',
      args: ['-rf', '/'],
      status: 'pending',
      content: 'Trying to run rm -rf /',
      timestamp: new Date().toISOString(),
    },
  ] as ChatMessage[],
};

describe('Chat Page', () => {
  afterEach(() => {
    appState.verbosityLevel = 'default';
  });

  it('filters messages based on default verbosity', async () => {
    appState.verbosityLevel = 'default';
    render(ChatPage, { props: { data: mockData } });

    const userMsgs = page.getByTestId('user-message').all();
    const agentMsgs = page.getByTestId('agent-message').all();
    const policyMsgs = page.getByTestId('policy-message').all();
    const logMsgs = page.getByTestId('log-message').all();

    expect(userMsgs.length).toBe(1);
    expect(agentMsgs.length).toBe(1);
    expect(policyMsgs.length).toBe(1);
    expect(logMsgs.length).toBe(1);
    await expect.element(logMsgs[0]).toHaveTextContent('I am the daemon');
  });

  it('filters messages based on debug verbosity', async () => {
    appState.verbosityLevel = 'debug';
    render(ChatPage, { props: { data: mockData } });

    const logMsgs = page.getByTestId('log-message').all();
    // command, legacy default, legacy debug
    expect(logMsgs.length).toBe(3);
    await expect.element(logMsgs[0]).toHaveTextContent('I am the daemon');
    await expect.element(logMsgs[1]).toHaveTextContent('Debug message');
  });

  it('filters messages based on verbose verbosity and shows details', async () => {
    appState.verbosityLevel = 'verbose';
    render(ChatPage, { props: { data: mockData } });

    const logMsgs = page.getByTestId('log-message').all();
    expect(logMsgs.length).toBe(4); // all logs + command log

    // Check verbose distinct rendering for legacy_log
    await expect.element(logMsgs[2]).toHaveClass(/bg-primary\/5/);

    const errorMsg = page.getByText('Command failed');
    await expect.element(errorMsg).toBeInTheDocument();
    await expect.element(errorMsg).toHaveClass(/text-destructive/);
  });
});
