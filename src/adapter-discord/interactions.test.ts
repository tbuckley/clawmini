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
      isChatInputCommand: vi.fn().mockReturnValue(false),
      isRepliable: vi.fn().mockReturnValue(true),
      user: { id: 'user-1' },
      customId: '',
      channelId: 'channel-1',
      update: vi.fn().mockResolvedValue({}),
      followUp: vi.fn().mockResolvedValue({}),
      reply: vi.fn().mockResolvedValue({}),
      deferReply: vi.fn().mockResolvedValue({}),
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
    await handleDiscordInteraction(mockInteraction, config, mockTrpc, { filters: {} });

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
      channelChatMap: { 'channel-1': { chatId: 'mapped-chat' } },
    });
    await handleDiscordInteraction(mockInteraction, config, mockTrpc, { filters: {} });

    expect(mockTrpc.sendMessage.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          chatId: 'mapped-chat',
        }),
      })
    );
  });

  it('routes modal_reject to mapped chat if explicit chat ID is empty string', async () => {
    mockInteraction.isButton.mockReturnValue(false);
    mockInteraction.isModalSubmit.mockReturnValue(true);
    mockInteraction.isFromMessage = vi.fn().mockReturnValue(true);
    mockInteraction.fields = {
      getTextInputValue: vi.fn().mockReturnValue('nope'),
    };
    mockInteraction.customId = 'modal_reject|policy-1|';

    vi.mocked(readDiscordState).mockResolvedValue({
      channelChatMap: { 'channel-1': { chatId: 'mapped-chat' } },
    });

    await handleDiscordInteraction(mockInteraction, config, mockTrpc, { filters: {} });

    expect(mockTrpc.sendMessage.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          chatId: 'mapped-chat',
        }),
      })
    );
  });

  describe('chat input commands', () => {
    beforeEach(() => {
      mockInteraction.isButton.mockReturnValue(false);
      mockInteraction.isModalSubmit.mockReturnValue(false);
      mockInteraction.isChatInputCommand.mockReturnValue(true);
      mockInteraction.options = {
        getString: vi.fn(),
      };
    });

    it('routes basic commands like /pending', async () => {
      mockInteraction.commandName = 'pending';

      await handleDiscordInteraction(mockInteraction, config, mockTrpc, { filters: {} });

      expect(mockInteraction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
      expect(mockTrpc.sendMessage.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            message: '/pending',
          }),
        })
      );
    });

    it('routes commands with arguments like /reject', async () => {
      mockInteraction.commandName = 'reject';
      mockInteraction.options.getString.mockImplementation((name: string) => {
        if (name === 'policy_id') return 'req-123';
        if (name === 'rationale') return 'too risky';
        return null;
      });

      await handleDiscordInteraction(mockInteraction, config, mockTrpc, { filters: {} });

      expect(mockInteraction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
      expect(mockTrpc.sendMessage.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            message: '/reject req-123 too risky',
          }),
        })
      );
    });
  });
});
