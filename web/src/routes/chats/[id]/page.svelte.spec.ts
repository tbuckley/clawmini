import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
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
    },
    {
      id: 'log-2',
      messageId: 'msg-1',
      role: 'log',
      content: '',
      command: 'exit 1',
      cwd: '/tmp',
      exitCode: 1,
      stdout: '',
      stderr: 'Command failed',
      timestamp: new Date().toISOString(),
    },
  ] as ChatMessage[],
};

describe('Chat Page', () => {
  it('renders user and log messages distinctly', async () => {
    appState.debugView = true;
    render(ChatPage, { props: { data: mockData } });

    const userMsgs = page.getByTestId('user-message').all();
    const logMsgs = page.getByTestId('log-message').all();

    expect(userMsgs.length).toBe(1);
    await expect.element(userMsgs[0]).toHaveTextContent('Hello daemon');
    await expect.element(userMsgs[0]).toHaveClass(/bg-primary/);

    expect(logMsgs.length).toBe(2);
    await expect.element(logMsgs[0]).toHaveTextContent('I am the daemon');
    await expect.element(logMsgs[0]).toHaveClass(/bg-card/);

    const errorMsg = page.getByText('Command failed');
    await expect.element(errorMsg).toBeInTheDocument();
    await expect.element(errorMsg).toHaveClass(/text-destructive/);
  });
});
