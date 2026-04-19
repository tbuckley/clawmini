import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as auth from './auth.js';
import * as state from './state.js';

vi.mock('./state.js', () => ({
  readGoogleChatState: vi.fn(),
  updateGoogleChatState: vi.fn(),
}));

const mockOn = vi.fn();

vi.mock('googleapis', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const MockOAuth2 = function (this: any) {
    this.on = mockOn;
    this.setCredentials = vi.fn();
    this.generateAuthUrl = vi.fn().mockReturnValue('http://mock-auth-url');
    this.getToken = vi.fn().mockResolvedValue({ tokens: { access_token: 'new_token_from_code' } });
  };
  return {
    google: {
      auth: { OAuth2: MockOAuth2 },
    },
  };
});

describe('auth.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should only update oauthTokens when new tokens are emitted to prevent overwriting state', async () => {
    const mockState = {
      lastSyncedMessageIds: { default: '123' },
      activeSpaceName: 'Space1',
      oauthTokens: { access_token: 'old_token' },
    };

    vi.mocked(state.readGoogleChatState).mockResolvedValue(mockState);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let tokenCallback: any;
    mockOn.mockImplementation((event, cb) => {
      if (event === 'tokens') {
        tokenCallback = cb;
      }
    });

    const config = {
      projectId: 'test-project',
      subscriptionName: 'test-sub',
      topicName: 'test-topic',
      authorizedUsers: [],
      requireMention: false,
      oauthClientId: 'client-id',
      oauthClientSecret: 'client-secret',
    };

    const authPromise = auth.getUserAuthClient(config);

    await vi.waitFor(() => {
      expect(mockOn).toHaveBeenCalledWith('tokens', expect.any(Function));
    });

    await authPromise;

    const newTokens = { access_token: 'new_token' };
    await tokenCallback(newTokens);

    expect(state.updateGoogleChatState).toHaveBeenCalledWith(
      {
        oauthTokens: {
          access_token: 'new_token',
        },
      },
      expect.any(String)
    );

    expect(state.updateGoogleChatState).not.toHaveBeenCalledWith(
      expect.objectContaining({
        lastSyncedMessageIds: { default: '123' },
        activeSpaceName: 'Space1',
      }),
      expect.any(String)
    );
  });
});
