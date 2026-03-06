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
      role: 'log',
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
      role: 'log',
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
      role: 'log',
      content: '',
      command: 'exit 1',
      cwd: '/tmp',
      exitCode: 1,
      stdout: '',
      stderr: 'Command failed',
      timestamp: new Date().toISOString(),
      level: 'verbose',
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
    const logMsgs = page.getByTestId('log-message').all();

    expect(userMsgs.length).toBe(1);
    expect(logMsgs.length).toBe(1);
    await expect.element(logMsgs[0]).toHaveTextContent('I am the daemon');
  });

  it('filters messages based on debug verbosity', async () => {
    appState.verbosityLevel = 'debug';
    render(ChatPage, { props: { data: mockData } });

    const logMsgs = page.getByTestId('log-message').all();
    expect(logMsgs.length).toBe(2);
    await expect.element(logMsgs[0]).toHaveTextContent('I am the daemon');
    await expect.element(logMsgs[1]).toHaveTextContent('Debug message');
  });

  it('filters messages based on verbose verbosity and shows details', async () => {
    appState.verbosityLevel = 'verbose';
    render(ChatPage, { props: { data: mockData } });

    const logMsgs = page.getByTestId('log-message').all();
    expect(logMsgs.length).toBe(3);

    // Check verbose distinct rendering
    await expect.element(logMsgs[2]).toHaveClass(/bg-primary\/5/);

    const errorMsg = page.getByText('Command failed');
    await expect.element(errorMsg).toBeInTheDocument();
    await expect.element(errorMsg).toHaveClass(/text-destructive/);
  });
});
