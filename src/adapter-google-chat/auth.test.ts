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

  it('should only update driveOauthTokens when new tokens are emitted to prevent overwriting state', async () => {
    const mockState = {
      lastSyncedMessageId: '123',
      activeSpaceName: 'Space1',
      driveOauthTokens: { access_token: 'old_token' },
    };

    vi.mocked(state.readGoogleChatState).mockResolvedValue(mockState);

    let tokenCallback: any;
    mockOn.mockImplementation((event, cb) => {
      if (event === 'tokens') {
        tokenCallback = cb;
      }
    });

    const config = {
      projectId: 'test',
      subscriptionName: 'test-sub',
      authorizedUsers: [],
      driveOauthClientId: 'client-id',
      driveOauthClientSecret: 'client-secret',
    };

    const authPromise = auth.getDriveAuthClient(config);

    await vi.waitFor(() => {
      expect(mockOn).toHaveBeenCalledWith('tokens', expect.any(Function));
    });

    await authPromise;

    const newTokens = { access_token: 'new_token' };
    await tokenCallback(newTokens);

    expect(state.updateGoogleChatState).toHaveBeenCalledWith({
      driveOauthTokens: {
        access_token: 'new_token',
      },
    });

    expect(state.updateGoogleChatState).not.toHaveBeenCalledWith(
      expect.objectContaining({
        lastSyncedMessageId: '123',
        activeSpaceName: 'Space1',
      })
    );
  });
});
