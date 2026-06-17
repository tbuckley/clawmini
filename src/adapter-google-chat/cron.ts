import { readGoogleChatState, updateGoogleChatState } from './state.js';
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
    console.log(`Renewed subscription ${sub.name} for space ${externalContextId}`);
  } catch (err) {
    console.error(`Failed to renew subscription for space ${externalContextId}:`, err);
  }
}

export async function renewExpiringSubscriptions(config: GoogleChatConfig): Promise<void> {
  const state = await readGoogleChatState();
  if (!state.channelChatMap) return;

  const now = Date.now();

  for (const [externalContextId, entry] of Object.entries(state.channelChatMap)) {
    if (!entry.subscriptionId || !entry.expirationDate) continue;

    const timeUntilExpiration = new Date(entry.expirationDate).getTime() - now;
    if (timeUntilExpiration >= FORTY_EIGHT_HOURS_MS) continue;

    // PATCH renewal isn't usable for chat-space user-authority subs (Google
    // caps their lifetime well below 7 days, so any TTL we ask for fails
    // with "exceeds maximum allowed"). Just recreate when within the window.
    await recreateSubscription(externalContextId, config);
  }
}
