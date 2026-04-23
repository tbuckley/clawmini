import { google } from 'googleapis';
import type { GoogleChatConfig } from './config.js';
import { getAuthClient, getUserAuthClient } from './auth.js';
import { updateGoogleChatState, type GoogleChatState } from './state.js';

interface OperationResponse {
  name: string;
  done?: boolean;
  response?: { name?: string; expireTime?: string };
  error?: { code?: number; message?: string };
}

export interface CreatedSubscription {
  name: string;
  expireTime: string;
}

async function pollOperation(operationName: string, token: string): Promise<OperationResponse> {
  const delaysMs = [500, 1000, 2000, 3000, 5000, 5000];
  for (const delay of delaysMs) {
    const res = await fetch(`https://workspaceevents.googleapis.com/v1/${operationName}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error(
        `Failed to poll operation ${operationName}: HTTP ${res.status} ${await res.text()}`
      );
    }
    const op = (await res.json()) as OperationResponse;
    if (op.done) return op;
    await new Promise((r) => setTimeout(r, delay));
  }
  throw new Error(`Operation ${operationName} did not complete within timeout`);
}

function postCreateSubscription(token: string, spaceName: string, config: GoogleChatConfig) {
  return fetch('https://workspaceevents.googleapis.com/v1/subscriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      targetResource: `//chat.googleapis.com/${spaceName}`,
      eventTypes: ['google.workspace.chat.message.v1.created'],
      authority: 'users/me',
      payloadOptions: { includeResource: true },
      notificationEndpoint: {
        pubsubTopic: `projects/${config.projectId}/topics/${config.topicName}`,
      },
    }),
  });
}

function extractConflictingSubscription(errorBody: string): string | undefined {
  try {
    const parsed = JSON.parse(errorBody) as {
      error?: {
        details?: Array<{ reason?: string; metadata?: { current_subscription?: string } }>;
      };
    };
    return parsed.error?.details?.find((d) => d.reason === 'SUBSCRIPTION_ALREADY_EXISTS')?.metadata
      ?.current_subscription;
  } catch {
    return undefined;
  }
}

async function getBotToken(): Promise<string> {
  const auth = await getAuthClient();
  const tokenResponse = await auth.getAccessToken();
  const token =
    typeof tokenResponse === 'string' ? tokenResponse : (tokenResponse?.token ?? undefined);
  if (!token) throw new Error('Failed to obtain bot service-account access token');
  return token;
}

export async function createSpaceSubscription(
  spaceName: string,
  config: GoogleChatConfig,
  startDir: string = process.cwd()
): Promise<CreatedSubscription> {
  const userAuthClient = await getUserAuthClient(config, startDir);
  const tokenResponse = await userAuthClient.getAccessToken();
  const token = tokenResponse.token;
  if (!token) throw new Error('No user OAuth access token available');

  let res = await postCreateSubscription(token, spaceName, config);

  if (res.status === 409) {
    // A subscription already exists for this (target, topic, event) tuple.
    // Common case: a stale legacy app-authority sub created before we set
    // `authority: 'users/me'`. The user OAuth can't see/delete app-authority
    // subs, so use the bot's service-account ADC for the cleanup.
    const errBody = await res.text();
    const conflictingName = extractConflictingSubscription(errBody);
    if (!conflictingName) {
      throw new Error(`Subscription create returned 409 without a conflict name: ${errBody}`);
    }
    console.warn(
      `Conflicting subscription ${conflictingName} exists for ${spaceName}; deleting via bot ADC and retrying`
    );
    const botToken = await getBotToken();
    const delRes = await fetch(`https://workspaceevents.googleapis.com/v1/${conflictingName}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${botToken}` },
    });
    if (!delRes.ok) {
      throw new Error(
        `Failed to delete conflicting subscription ${conflictingName}: HTTP ${delRes.status} ${await delRes.text()}`
      );
    }
    res = await postCreateSubscription(token, spaceName, config);
  }

  if (!res.ok) {
    throw new Error(
      `Failed to create subscription for ${spaceName}: HTTP ${res.status} ${await res.text()}`
    );
  }

  const operation = (await res.json()) as OperationResponse;
  const resolved = operation.done ? operation : await pollOperation(operation.name, token);

  if (resolved.error) {
    throw new Error(`Subscription create operation errored: ${JSON.stringify(resolved.error)}`);
  }
  const name = resolved.response?.name;
  const expireTime = resolved.response?.expireTime;
  if (!name || !expireTime) {
    throw new Error(
      `Subscription create operation completed without expected fields: ${JSON.stringify(resolved)}`
    );
  }
  return { name, expireTime };
}

export async function handleAddedToSpace(
  spaceName: string,
  externalContextId: string,
  spaceType: string | undefined,
  targetChatId: string | null | undefined,
  mappedChatId: string | null | undefined,
  config: GoogleChatConfig,
  startDir: string = process.cwd()
) {
  if (spaceType !== 'DIRECT_MESSAGE') {
    try {
      const sub = await createSpaceSubscription(spaceName, config, startDir);
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
      }, startDir);
      console.log(`Created subscription ${sub.name} for space ${externalContextId}`);
    } catch (err) {
      console.error(`Failed to create subscription for space ${externalContextId}:`, err);
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
  config: GoogleChatConfig,
  startDir: string = process.cwd()
) {
  const subId = currentState.channelChatMap?.[externalContextId]?.subscriptionId;
  if (subId) {
    try {
      const userAuthClient = await getUserAuthClient(config, startDir);
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
  }, startDir);
}
