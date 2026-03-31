import { readGoogleChatState, updateGoogleChatState } from './state.js';
import { getUserAuthClient } from './auth.js';
import type { GoogleChatConfig } from './config.js';

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

export async function renewExpiringSubscriptions(config: GoogleChatConfig): Promise<void> {
  const state = await readGoogleChatState();
  if (!state.channelChatMap) return;

  const now = Date.now();
  const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;

  for (const [externalContextId, entry] of Object.entries(state.channelChatMap)) {
    if (entry.subscriptionId && entry.expirationDate) {
      const expirationTime = new Date(entry.expirationDate).getTime();
      const timeUntilExpiration = expirationTime - now;

      if (timeUntilExpiration < FORTY_EIGHT_HOURS_MS) {
        console.log(
          `Renewing expiring subscription ${entry.subscriptionId} for space ${externalContextId}`
        );
        try {
          const userAuthClient = await getUserAuthClient(config);
          const tokenResponse = await userAuthClient.getAccessToken();
          const token = tokenResponse.token;

          if (token) {
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
            } else {
              const errText = await res.text();
              console.error(`Failed to renew subscription ${entry.subscriptionId}:`, errText);
            }
          }
        } catch (err) {
          console.error(`Error renewing subscription ${entry.subscriptionId}:`, err);
        }
      }
    }
  }
}
