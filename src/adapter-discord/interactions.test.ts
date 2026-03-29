import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleDiscordInteraction } from './interactions.js';
import { readDiscordState } from './state.js';

vi.mock('./state.js', () => ({
  readDiscordState: vi.fn(),
}));

describe('handleDiscordInteraction', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockTrpc: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockInteraction: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockTrpc = {
      sendMessage: {
        mutate: vi.fn().mockResolvedValue({}),
      },
    };
    mockInteraction = {
      isButton: vi.fn().mockReturnValue(true),
      isModalSubmit: vi.fn().mockReturnValue(false),
      user: { id: 'user-1' },
      customId: '',
      channelId: 'channel-1',
      update: vi.fn().mockResolvedValue({}),
      followUp: vi.fn().mockResolvedValue({}),
      showModal: vi.fn().mockResolvedValue({}),
    };
    vi.mocked(readDiscordState).mockResolvedValue({});
  });

  const config = {
    authorizedUserId: 'user-1',
    botToken: 'token',
    clientId: 'client',
    chatId: 'default',
    maxAttachmentSizeMB: 10,
    requireMention: false,
  };

  it('routes approve to explicit chat if provided', async () => {
    mockInteraction.customId = 'approve|policy-1|explicit-chat';
    await handleDiscordInteraction(mockInteraction, config, mockTrpc);

    expect(mockTrpc.sendMessage.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          chatId: 'explicit-chat',
        }),
      })
    );
  });

  it('routes approve to channel mapped chat if explicit not provided', async () => {
    mockInteraction.customId = 'approve_policy-1';
    vi.mocked(readDiscordState).mockResolvedValue({
      channelChatMap: { 'channel-1': 'mapped-chat' },
    });
    await handleDiscordInteraction(mockInteraction, config, mockTrpc);

    expect(mockTrpc.sendMessage.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          chatId: 'mapped-chat',
        }),
      })
    );
  });
});
