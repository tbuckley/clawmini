import { describe, it, expect, vi, beforeEach } from 'vitest';
import { appRouter } from './router.js';
import { daemonEvents, DAEMON_EVENT_MESSAGE_APPENDED } from './events.js';
import * as daemonChats from './chats.js';

vi.mock('./chats.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./chats.js')>();
  return {
    ...actual,
    getMessages: vi.fn(),
    getDefaultChatId: vi.fn(),
  };
});

describe('Daemon Message Observation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    daemonEvents.removeAllListeners();
  });

  it('getMessages should return messages from chats module', async () => {
    const mockMessages = [{ id: '1', role: 'user', content: 'hello', timestamp: '...' }];
    vi.mocked(daemonChats.getMessages).mockResolvedValue(mockMessages as any);
    vi.mocked(daemonChats.getDefaultChatId).mockResolvedValue('chat-1');

    const caller = appRouter.createCaller({});
    const result = await caller.getMessages({ chatId: 'chat-1', limit: 10 });

    expect(result).toEqual(mockMessages);
    expect(daemonChats.getMessages).toHaveBeenCalledWith('chat-1', 10);
  });

  it('waitForMessages should return new messages immediately if they exist after lastMessageId', async () => {
    const mockMessages = [
      { id: '1', role: 'user', content: 'hello', timestamp: '...' },
      { id: '2', role: 'log', content: 'hi', timestamp: '...' },
      { id: '3', role: 'user', content: 'how are you?', timestamp: '...' },
    ];
    vi.mocked(daemonChats.getMessages).mockResolvedValue(mockMessages as any);
    vi.mocked(daemonChats.getDefaultChatId).mockResolvedValue('chat-1');

    const caller = appRouter.createCaller({});
    const result = await caller.waitForMessages({ chatId: 'chat-1', lastMessageId: '1' });

    expect(result).toHaveLength(2);
    expect(result![0]!.id).toBe('2');
    expect(result![1]!.id).toBe('3');
  });

  it('waitForMessages should wait for a new message if none are available after lastMessageId', async () => {
    const mockMessages = [{ id: '1', role: 'user', content: 'hello', timestamp: '...' }];
    vi.mocked(daemonChats.getMessages).mockResolvedValue(mockMessages as any);
    vi.mocked(daemonChats.getDefaultChatId).mockResolvedValue('chat-1');

    const caller = appRouter.createCaller({});

    const waitPromise = caller.waitForMessages({ chatId: 'chat-1', lastMessageId: '1' });

    const newMessage = { id: '2', role: 'log', content: 'hi', timestamp: '...' };

    // Simulate message arrival
    setTimeout(() => {
      daemonEvents.emit(DAEMON_EVENT_MESSAGE_APPENDED, { chatId: 'chat-1', message: newMessage });
    }, 10);

    const result = await waitPromise;
    expect(result).toHaveLength(1);
    expect(result![0]!.id).toBe('2');
  });

  it('waitForMessages should timeout if no message arrives', async () => {
    vi.mocked(daemonChats.getMessages).mockResolvedValue([]);
    vi.mocked(daemonChats.getDefaultChatId).mockResolvedValue('chat-1');

    const caller = appRouter.createCaller({});
    const result = await caller.waitForMessages({ chatId: 'chat-1', timeout: 50 });

    expect(result).toHaveLength(0);
  });

  it('waitForMessages should ignore messages for other chats while waiting', async () => {
    vi.mocked(daemonChats.getMessages).mockResolvedValue([]);
    vi.mocked(daemonChats.getDefaultChatId).mockResolvedValue('chat-1');

    const caller = appRouter.createCaller({});

    const waitPromise = caller.waitForMessages({ chatId: 'chat-1', timeout: 100 });

    // Simulate message for another chat
    setTimeout(() => {
      daemonEvents.emit(DAEMON_EVENT_MESSAGE_APPENDED, {
        chatId: 'other-chat',
        message: { id: 'x', role: 'user', content: 'wrong', timestamp: '...' },
      });
    }, 20);

    const result = await waitPromise;
    expect(result).toHaveLength(0); // Should timeout because 'chat-1' never got a message
  });
});
