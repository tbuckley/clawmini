import { readGoogleChatState, updateGoogleChatState } from './state.js';
import { getUserAuthClient } from './auth.js';
import type { GoogleChatConfig } from './config.js';
import { createSpaceSubscription } from './subscriptions.js';

const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;

export function startSubscriptionRenewalCron(config: GoogleChatConfig): NodeJS.Timeout {
  // Run every hour
  return setInterval(
    async () => {
      try {
        await renewExpiringSubscriptions(config);
      } catch (err) {
        console.error('Error in subscription renewal cron:', err);
      }
    },
    1000 * 60 * 60
  );
}

async function recreateSubscription(
  externalContextId: string,
  config: GoogleChatConfig
): Promise<void> {
  try {
    const sub = await createSpaceSubscription(externalContextId, config);
    await updateGoogleChatState((latestState) => {
      const currentMap = latestState.channelChatMap || {};
      return {
        channelChatMap: {
          ...currentMap,
          [externalContextId]: {
            ...(currentMap[externalContextId] || {}),
            subscriptionId: sub.name,
            expirationDate: sub.expireTime,
          },
        },
      };
    });
    console.log(`Recreated subscription ${sub.name} for space ${externalContextId}`);
  } catch (err) {
    console.error(`Failed to recreate subscription for space ${externalContextId}:`, err);
  }
}

export async function renewExpiringSubscriptions(config: GoogleChatConfig): Promise<void> {
  const state = await readGoogleChatState();
  if (!state.channelChatMap) return;

  const now = Date.now();

  for (const [externalContextId, entry] of Object.entries(state.channelChatMap)) {
    if (!entry.subscriptionId || !entry.expirationDate) continue;

    const expirationTime = new Date(entry.expirationDate).getTime();
    const timeUntilExpiration = expirationTime - now;

    if (timeUntilExpiration <= 0) {
      console.log(
        `Subscription ${entry.subscriptionId} for space ${externalContextId} is past expiration; recreating`
      );
      await recreateSubscription(externalContextId, config);
      continue;
    }

    if (timeUntilExpiration >= FORTY_EIGHT_HOURS_MS) continue;

    console.log(
      `Renewing expiring subscription ${entry.subscriptionId} for space ${externalContextId}`
    );
    try {
      const userAuthClient = await getUserAuthClient(config);
      const tokenResponse = await userAuthClient.getAccessToken();
      const token = tokenResponse.token;
      if (!token) continue;

      const res = await fetch(
        `https://workspaceevents.googleapis.com/v1/${entry.subscriptionId}?updateMask=ttl`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ttl: '604800s', // 7 days
          }),
        }
      );

      if (res.ok) {
        const subData = (await res.json()) as { expireTime: string };
        await updateGoogleChatState((latestState) => {
          const currentMap = latestState.channelChatMap || {};
          return {
            channelChatMap: {
              ...currentMap,
              [externalContextId]: {
                ...(currentMap[externalContextId] || {}),
                expirationDate: subData.expireTime,
              },
            },
          };
        });
        console.log(`Successfully renewed subscription ${entry.subscriptionId}`);
      } else if (res.status >= 400 && res.status < 500) {
        // 4xx means the subscription is gone, unreachable, or can't accept
        // this renewal (e.g. exceeds max lifetime). Recreate instead.
        const errText = await res.text();
        console.warn(
          `Subscription ${entry.subscriptionId} cannot be renewed (HTTP ${res.status}); recreating: ${errText}`
        );
        await recreateSubscription(externalContextId, config);
      } else {
        // 5xx: transient — leave it alone and try again next hour.
        const errText = await res.text();
        console.error(`Failed to renew subscription ${entry.subscriptionId}:`, errText);
      }
    } catch (err) {
      console.error(`Error renewing subscription ${entry.subscriptionId}:`, err);
    }
  }
}
