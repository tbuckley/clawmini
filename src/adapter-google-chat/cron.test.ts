import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renewExpiringSubscriptions, startSubscriptionRenewalCron } from './cron.js';
import * as stateApi from './state.js';
import * as authApi from './auth.js';
import type { GoogleChatState } from './state.js';
import type { GoogleChatConfig } from './config.js';
import type { OAuth2Client } from 'google-auth-library';

// Mock dependencies
vi.mock('./state.js');
vi.mock('./auth.js');

describe('Subscription Renewal Cron', () => {
  const mockConfig: GoogleChatConfig = {
    projectId: 'test-project',
    credentialsPath: '/tmp/test-creds.json',
    subscriptionName: 'test-subscription',
    authorizedUsers: ['test-user'],
    oauthClientId: 'test-client',
    oauthClientSecret: 'test-secret',
    oauthTokens: { refresh_token: 'test-token' },
  };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();

    // Reset global fetch mock
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('startSubscriptionRenewalCron should schedule execution every hour', async () => {
    vi.mocked(stateApi.readGoogleChatState).mockResolvedValue({} as GoogleChatState);

    const timer = startSubscriptionRenewalCron(mockConfig);
    expect(timer).toBeDefined();

    await vi.advanceTimersByTimeAsync(1000 * 60 * 60);

    expect(stateApi.readGoogleChatState).toHaveBeenCalledTimes(1);
    clearInterval(timer);
  });

  it('renewExpiringSubscriptions should do nothing if channelChatMap is empty', async () => {
    vi.mocked(stateApi.readGoogleChatState).mockResolvedValue({} as GoogleChatState);

    await renewExpiringSubscriptions(mockConfig);

    expect(authApi.getUserAuthClient).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('renewExpiringSubscriptions should not renew subscriptions expiring in more than 48 hours', async () => {
    const farFuture = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
    vi.mocked(stateApi.readGoogleChatState).mockResolvedValue({
      channelChatMap: {
        space1: {
          chatId: 'chat1',
          subscriptionId: 'subscriptions/123',
          expirationDate: farFuture,
        },
      },
    } as unknown as GoogleChatState);

    await renewExpiringSubscriptions(mockConfig);

    expect(authApi.getUserAuthClient).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('renewExpiringSubscriptions should renew subscriptions expiring in less than 48 hours', async () => {
    const nearFuture = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    vi.mocked(stateApi.readGoogleChatState).mockResolvedValue({
      channelChatMap: {
        space1: {
          chatId: 'chat1',
          subscriptionId: 'subscriptions/123',
          expirationDate: nearFuture,
        },
      },
    } as unknown as GoogleChatState);

    vi.mocked(authApi.getUserAuthClient).mockResolvedValue({
      getAccessToken: vi.fn().mockResolvedValue({ token: 'mock-token' }),
    } as unknown as OAuth2Client);

    const newExpireTime = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ expireTime: newExpireTime }),
    } as unknown as Response);

    await renewExpiringSubscriptions(mockConfig);

    expect(authApi.getUserAuthClient).toHaveBeenCalledWith(mockConfig);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://workspaceevents.googleapis.com/v1/subscriptions/123?updateMask=ttl',
      expect.objectContaining({
        method: 'PATCH',
        headers: {
          Authorization: 'Bearer mock-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ttl: '604800s' }),
      })
    );

    expect(stateApi.updateGoogleChatState).toHaveBeenCalled();
  });

  it('renewExpiringSubscriptions should handle fetch errors gracefully', async () => {
    const nearFuture = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    vi.mocked(stateApi.readGoogleChatState).mockResolvedValue({
      channelChatMap: {
        space1: {
          chatId: 'chat1',
          subscriptionId: 'subscriptions/123',
          expirationDate: nearFuture,
        },
      },
    } as unknown as GoogleChatState);

    vi.mocked(authApi.getUserAuthClient).mockResolvedValue({
      getAccessToken: vi.fn().mockResolvedValue({ token: 'mock-token' }),
    } as unknown as OAuth2Client);

    vi.mocked(global.fetch).mockResolvedValue({
      ok: false,
      text: vi.fn().mockResolvedValue('Internal Server Error'),
    } as unknown as Response);

    await renewExpiringSubscriptions(mockConfig);

    expect(global.fetch).toHaveBeenCalled();
    expect(stateApi.updateGoogleChatState).not.toHaveBeenCalled();
  });
});
