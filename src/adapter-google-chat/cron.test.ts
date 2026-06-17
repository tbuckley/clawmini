import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renewExpiringSubscriptions, startSubscriptionRenewalCron } from './cron.js';
import * as stateApi from './state.js';
import * as subscriptionsApi from './subscriptions.js';
import type { GoogleChatState } from './state.js';
import type { GoogleChatConfig } from './config.js';

vi.mock('./state.js');
vi.mock('./subscriptions.js');

describe('Subscription Renewal Cron', () => {
  const mockConfig: GoogleChatConfig = {
    projectId: 'test-project',
    credentialsPath: '/tmp/test-creds.json',
    subscriptionName: 'test-subscription',
    topicName: 'test-topic',
    authorizedUsers: ['test-user'],
    requireMention: false,
    oauthClientId: 'test-client',
    oauthClientSecret: 'test-secret',
    oauthTokens: { refresh_token: 'test-token' },
  };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
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

    expect(subscriptionsApi.createSpaceSubscription).not.toHaveBeenCalled();
  });

  it('should not recreate subscriptions expiring in more than 48 hours', async () => {
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

    expect(subscriptionsApi.createSpaceSubscription).not.toHaveBeenCalled();
  });

  it('should recreate subscriptions expiring within 48 hours', async () => {
    const nearFuture = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    vi.mocked(stateApi.readGoogleChatState).mockResolvedValue({
      channelChatMap: {
        space1: {
          chatId: 'chat1',
          subscriptionId: 'subscriptions/old',
          expirationDate: nearFuture,
        },
      },
    } as unknown as GoogleChatState);
    vi.mocked(subscriptionsApi.createSpaceSubscription).mockResolvedValue({
      name: 'subscriptions/new',
      expireTime: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
    });

    await renewExpiringSubscriptions(mockConfig);

    expect(subscriptionsApi.createSpaceSubscription).toHaveBeenCalledWith('space1', mockConfig);
    expect(stateApi.updateGoogleChatState).toHaveBeenCalled();
  });

  it('should recreate already-expired subscriptions', async () => {
    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    vi.mocked(stateApi.readGoogleChatState).mockResolvedValue({
      channelChatMap: {
        space1: {
          chatId: 'chat1',
          subscriptionId: 'subscriptions/old',
          expirationDate: past,
        },
      },
    } as unknown as GoogleChatState);
    vi.mocked(subscriptionsApi.createSpaceSubscription).mockResolvedValue({
      name: 'subscriptions/new',
      expireTime: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
    });

    await renewExpiringSubscriptions(mockConfig);

    expect(subscriptionsApi.createSpaceSubscription).toHaveBeenCalledWith('space1', mockConfig);
  });

  it('should swallow recreate errors and continue with other entries', async () => {
    const nearFuture = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    vi.mocked(stateApi.readGoogleChatState).mockResolvedValue({
      channelChatMap: {
        space1: {
          chatId: 'chat1',
          subscriptionId: 'subscriptions/a',
          expirationDate: nearFuture,
        },
        space2: {
          chatId: 'chat2',
          subscriptionId: 'subscriptions/b',
          expirationDate: nearFuture,
        },
      },
    } as unknown as GoogleChatState);
    vi.mocked(subscriptionsApi.createSpaceSubscription)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({
        name: 'subscriptions/b-new',
        expireTime: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
      });

    await renewExpiringSubscriptions(mockConfig);

    expect(subscriptionsApi.createSpaceSubscription).toHaveBeenCalledTimes(2);
  });
});
