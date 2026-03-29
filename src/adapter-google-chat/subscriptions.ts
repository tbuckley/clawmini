import { google } from 'googleapis';
import type { GoogleChatConfig } from './config.js';
import { getAuthClient, getUserAuthClient } from './auth.js';
import { updateGoogleChatState, type GoogleChatState } from './state.js';

export async function handleAddedToSpace(
  spaceName: string,
  externalContextId: string,
  spaceType: string | undefined,
  targetChatId: string | null | undefined,
  mappedChatId: string | null | undefined,
  config: GoogleChatConfig
) {
  if (spaceType !== 'DIRECT_MESSAGE') {
    try {
      const userAuthClient = await getUserAuthClient(config);
      const tokenResponse = await userAuthClient.getAccessToken();
      const token = tokenResponse.token;

      if (token) {
        const res = await fetch('https://workspaceevents.googleapis.com/v1/subscriptions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            targetResource: `//chat.googleapis.com/${spaceName}`,
            eventTypes: ['google.workspace.chat.message.v1.created'],
            payloadOptions: { includeResource: true },
          }),
        });

        if (res.ok) {
          const subData = (await res.json()) as { name: string; expireTime: string };
          await updateGoogleChatState((latestState) => {
            const currentMap = latestState.channelChatMap || {};
            return {
              channelChatMap: {
                ...currentMap,
                [externalContextId]: {
                  ...(currentMap[externalContextId] || {}),
                  subscriptionId: subData.name,
                  expirationDate: subData.expireTime,
                },
              },
            };
          });
          console.log(`Created subscription ${subData.name} for space ${externalContextId}`);
        } else {
          const errText = await res.text();
          console.error(`Failed to create subscription for space ${externalContextId}:`, errText);
        }
      }
    } catch (err) {
      console.error('Error setting up subscription on ADDED_TO_SPACE:', err);
    }
  }

  if (targetChatId && mappedChatId) {
    try {
      const authClient = await getAuthClient();
      const chatApi = google.chat({ version: 'v1', auth: authClient });
      await chatApi.spaces.messages.create({
        parent: externalContextId,
        requestBody: {
          text: `Hello! I am currently mapped to chat \`${targetChatId}\`.`,
        },
      });
    } catch (err) {
      console.error('Failed to send greeting on ADDED_TO_SPACE:', err);
    }
  }
}

export async function handleRemovedFromSpace(
  externalContextId: string,
  currentState: GoogleChatState,
  config: GoogleChatConfig
) {
  const subId = currentState.channelChatMap?.[externalContextId]?.subscriptionId;
  if (subId) {
    try {
      const userAuthClient = await getUserAuthClient(config);
      const tokenResponse = await userAuthClient.getAccessToken();
      const token = tokenResponse.token;

      if (token) {
        const res = await fetch(`https://workspaceevents.googleapis.com/v1/${subId}`, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (res.ok) {
          console.log(`Deleted subscription ${subId}`);
        } else {
          const errText = await res.text();
          console.error(`Failed to delete subscription ${subId}:`, errText);
        }
      }
    } catch (err) {
      console.error('Error tearing down subscription on REMOVED_FROM_SPACE:', err);
    }
  }

  await updateGoogleChatState((latestState) => {
    const map = { ...(latestState.channelChatMap || {}) };
    const entry = map[externalContextId];
    if (entry) {
      if (!entry.chatId) {
        delete map[externalContextId];
      } else {
        delete entry.subscriptionId;
        delete entry.expirationDate;
      }
    }
    return { channelChatMap: map };
  });
}
