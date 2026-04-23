import { describe, it, expect, vi, beforeEach } from 'vitest';
import { userRouter as appRouter } from './api/index.js';
import { daemonEvents, emitMessageAppended } from './events.js';
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
    vi.mocked(daemonChats.getMessages).mockResolvedValue(
      mockMessages as unknown as import('./chats.js').ChatMessage[]
    );
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
    vi.mocked(daemonChats.getMessages).mockResolvedValue(
      mockMessages as unknown as import('./chats.js').ChatMessage[]
    );
    vi.mocked(daemonChats.getDefaultChatId).mockResolvedValue('chat-1');

    const caller = appRouter.createCaller({});
    const iterable = await caller.waitForMessages({ chatId: 'chat-1', lastMessageId: '1' });
    const iterator = iterable[Symbol.asyncIterator]();
    const result = (await iterator.next()).value;

    expect(result).toHaveLength(2);
    expect(result![0]).toMatchObject({ kind: 'message', message: { id: '2' } });
    expect(result![1]).toMatchObject({ kind: 'message', message: { id: '3' } });
  });

  it('waitForMessages should wait for a new message if none are available after lastMessageId', async () => {
    const mockMessages = [{ id: '1', role: 'user', content: 'hello', timestamp: '...' }];
    vi.mocked(daemonChats.getMessages).mockResolvedValue(
      mockMessages as unknown as import('./chats.js').ChatMessage[]
    );
    vi.mocked(daemonChats.getDefaultChatId).mockResolvedValue('chat-1');

    const caller = appRouter.createCaller({});

    const iterable = await caller.waitForMessages({ chatId: 'chat-1', lastMessageId: '1' });
    const iterator = iterable[Symbol.asyncIterator]();

    const waitPromise = iterator.next();

    const newMessage = {
      id: '2',
      role: 'log' as const,
      content: 'hi',
      timestamp: '...',
    } as unknown as import('./chats.js').ChatMessage;

    // Simulate message arrival via the shared emit helper so the merged
    // chat-stream channel receives it alongside the legacy one.
    setTimeout(() => emitMessageAppended('chat-1', newMessage), 10);

    const result = await waitPromise;
    expect(result.value).toHaveLength(1);
    expect(result.value![0]).toMatchObject({ kind: 'message', message: { id: '2' } });
  });

  it('waitForMessages should ignore messages for other chats while waiting', async () => {
    vi.mocked(daemonChats.getMessages).mockResolvedValue([]);
    vi.mocked(daemonChats.getDefaultChatId).mockResolvedValue('chat-1');

    const caller = appRouter.createCaller({});

    const iterable = await caller.waitForMessages({ chatId: 'chat-1' });
    const iterator = iterable[Symbol.asyncIterator]();

    // Try to get next value
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let yieldedValue: any = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    iterator.next().then((res: any) => (yieldedValue = res.value));

    // Simulate message for another chat
    emitMessageAppended('other-chat', {
      id: 'x',
      role: 'user',
      content: 'wrong',
      timestamp: '...',
    } as unknown as import('./chats.js').ChatMessage);

    // Wait a tick
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(yieldedValue).toBeNull(); // Should still be waiting

    // Now simulate the correct chat
    emitMessageAppended('chat-1', {
      id: 'y',
      role: 'user',
      content: 'right',
      timestamp: '...',
    } as unknown as import('./chats.js').ChatMessage);

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(yieldedValue).toHaveLength(1);
    expect(yieldedValue![0]).toMatchObject({ kind: 'message', message: { id: 'y' } });
  });
});
